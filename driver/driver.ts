/**
 * Improvements: add concurrent handling so that if 2 updates are made to graph
 * at the same time time, it will handle them concurrently
 * @returns
 */

import { AstroVault } from "../astrovault";

let astrodb: AstroVault | null = null;
let hnswWorker: Worker | null = null;

const initializeWorker = () => {
    if (hnswWorker) return;
    try {
        hnswWorker = new Worker(new URL("./worker.js", import.meta.url));
    } catch (error) {
        console.error("Failed to initialize HNSW worker:", error);
        // Handle the error appropriately, e.g., fallback to non-worker implementation
    }
};

initializeWorker();

// Queue for HNSW operations
let operationQueue: (() => Promise<void>)[] = [];
let isProcessing = false;

const createAstroDB = async () => {
    astrodb = await AstroVault.create(16, 200, "notes-astrodb-5");
    try {
        // load the index in from db and initialize the graph
        await astrodb.loadIndex();
    } catch (err) {
        // probably first time so create the index
        astrodb.buildIndex([]);
        await astrodb.saveIndex();
    }
};

export const getAstroDB = async (): Promise<AstroVault> => {
    if (astrodb === null) {
        await createAstroDB();
    }
    if (astrodb === null) {
        throw new Error("astrodb is null");
    }
    return astrodb;
};

// Function to add an operation to the queue
const addOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
        operationQueue.push(async () => {
            try {
                const result = await operation();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        });
        if (!isProcessing) {
            processQueue();
        }
    });
};

// Function to process the queue
const processQueue = async () => {
    if (isProcessing) return;
    isProcessing = true;

    while (operationQueue.length > 0) {
        const operation = operationQueue.shift();
        if (operation) {
            await operation();
        }
    }

    isProcessing = false;
};

/**
 * For syncing, after all operations done, then sync
 * @returns
 */
export const saveIndex = async () => {
    return new Promise<void>((resolve, reject) => {
        addOperation(async () => {
            const astrodb = await getAstroDB();
            try {
                await astrodb.saveIndex();
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
};

export const updateIndex = async (newHNSW: JSON, saveIndex = true) => {
    return new Promise<void>((resolve, reject) => {
        addOperation(async () => {
            const astrodb = await getAstroDB();
            try {
                astrodb.updateIndex(newHNSW);
                if (saveIndex) await astrodb.saveIndex();
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
};

export const addToAstroDB = async (
    uniqueid: string,
    vector: number[],
    withWorker: boolean = false
) => {
    return new Promise<string>((resolve, reject) => {
        addOperation(async () => {
            const astrodb = await getAstroDB();

            if (!uniqueid) {
                console.error("ADDING NOTE WITH NO UNIQUE ID");
                console.trace();
                reject(new Error("No unique ID provided"));
                return;
            }

            try {
                if (withWorker && hnswWorker) {
                    hnswWorker.onmessage = (event) => {
                        const { updatedHnsw } = event.data;
                        updateIndex(updatedHnsw);
                        resolve(uniqueid);
                    };

                    hnswWorker.postMessage({
                        operation: "addPoint",
                        hnsw: astrodb.toJSON(),
                        uniqueid,
                        vector,
                    });
                } else {
                    await astrodb.addPoint(uniqueid, vector);
                    await astrodb.saveIndex();
                    resolve(uniqueid);
                }
            } catch (error) {
                reject(error);
            }
        });
    });
};

export const removeFromAstroDB = async (uniqueid: string, saveIndex = true) => {
    return new Promise<string>((resolve, reject) => {
        addOperation(async () => {
            const astrodb = await getAstroDB();
            try {
                astrodb.removePoint(uniqueid);
                if (saveIndex) await astrodb.saveIndex();
                resolve(uniqueid);
            } catch (error) {
                reject(error);
            }
        });
    });
};

export const removeMultipleFromAstroDB = async (
    uniqueids: string[],
    saveIndex = true
) => {
    return new Promise<void>((resolve, reject) => {
        addOperation(async () => {
            const astrodb = await getAstroDB();

            try {
                for (const uniqueid of uniqueids) {
                    astrodb.removePoint(uniqueid);
                }

                if (saveIndex) await astrodb.saveIndex();
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
};

/**
 * Update from astrodb by removing the old uniqueid and adding the new one
 * @param uniqueid
 * @param vector
 * @returns
 */
export const updateVectorAstroDB = async (
    uniqueid: string,
    vector: number[],
    withWorker: boolean = false
) => {
    return new Promise<string>((resolve, reject) => {
        addOperation(async () => {
            const astrodb = await getAstroDB();

            try {
                if (withWorker && hnswWorker) {
                    hnswWorker.onmessage = (event) => {
                        const { updatedHnsw } = event.data;
                        updateIndex(updatedHnsw);
                        resolve(uniqueid);
                    };

                    hnswWorker.postMessage({
                        operation: "updatePoint",
                        hnsw: astrodb.toJSON(),
                        uniqueid,
                        vector,
                    });
                } else {
                    await astrodb.updatePoint(uniqueid, vector);
                    await astrodb.saveIndex();
                    resolve(uniqueid);
                }
            } catch (error) {
                reject(error);
            }
        });
    });
};

/**
 * Useful for adding many vectors to the graph at once (especially with the worker).
 * It will only add the new vectors that have changed by checking the uniqueid to see if it exists
 * and if the vector has changed.
 * Checks if the vector changed for the uniqueid and then only proceeds to
 * call update vector if it has changed. Also used for importing notes.
 * @param uniqueid
 * @param vector
 * @returns
 */
export const syncVectorsFromCloud = async (
    items: { uniqueid: string; vector: number[] }[],
    progressCallback?: (progress: number) => void
): Promise<void> => {
    return new Promise((resolve, reject) => {
        addOperation(async () => {
            try {
                const astrodb = await getAstroDB();
                if (!hnswWorker) {
                    initializeWorker();
                }
                if (hnswWorker) {
                    hnswWorker.onmessage = (event) => {
                        const { updatedHnsw, type, progress } = event.data;
                        if (type === "progress") {
                            console.log("Progress: ", progress);
                            if (progressCallback) progressCallback(progress);
                        } else {
                            console.log("Received updated hnsw from worker");
                            updateIndex(updatedHnsw).then(() => {
                                resolve();
                            });
                        }
                    };

                    hnswWorker.postMessage({
                        operation: "syncVectorsFromCloud",
                        hnsw: astrodb.toJSON(),
                        items: items,
                    });
                }
            } catch (e) {
                console.error("Error in syncVectorFromCloud:", e);
                reject(e);
            }
        });
    });
};

/**
 *
 * @param vector - the query vector
 * @param numb_nodes - the number of nodes to get back
 * @param similarityStrength - 0 to 100, the similarity strength (where 100 == almost identical)
 */
export const searchAstroDB = async (
    vector: number[],
    numb_nodes: number,
    similarityStrengthSetting: number = 50
) => {
    // divide by 100 to get a number between 0 and 1 for cosine similarity
    let similarityStrength = similarityStrengthSetting / 100;
    // cap to 0.95 to prevent excessively strict similarity
    similarityStrength = Math.min(0.95, similarityStrength);

    const astrodb = await getAstroDB();
    const results = await astrodb.searchKNNOptimized(
        vector,
        numb_nodes,
        similarityStrength
    );
    return results;
};

export const getSingleAstroDBNode = async (uniqueid: string) => {
    const astrodb = await getAstroDB();
    return astrodb.nodes.get(uniqueid);
};
