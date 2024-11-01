const { HNSW } = require("../astrovault");

const syncVectorsFromCloud = async (items, hnswInstance) => {
    return new Promise(async (resolve) => {
        for (let i = 0; i < items.length; i++) {
            try {
                const item = items[i];
                const existingVector =
                    hnswInstance.nodes.get(item.uniqueid)?.vector ?? null;
                if (!item.vector || item.vector.length === 0) {
                    console.log("Vector is empty for item: ", item);
                    continue;
                }
                // First check if the node exists in the graph
                if (existingVector) {
                    // Only if vector changed, then update it
                    if (
                        !existingVector?.every(
                            (value, index) => value === item.vector[index]
                        )
                    ) {
                        await hnswInstance.updatePoint(
                            item.uniqueid,
                            item.vector
                        );
                    }
                } else {
                    // if vector doesn't exist, add it
                    await hnswInstance.addPoint(item.uniqueid, item.vector);
                }

                // Send progress update to main thread
                if ((i + 1) % 25 === 0) {
                    const progress = ((i + 1) / items.length) * 100;
                    self.postMessage({ type: "progress", progress });
                }
            } catch (error) {
                console.error(`Error processing item ${i}:`, error);
                // Continue with next item
            }
        }
        resolve();
    });
};

self.onmessage = (event) => {
    try {
        const { operation, hnsw, uniqueid, vector, items } = event.data;

        // Deserialize HNSW
        const hnswInstance = HNSW.fromJSON(hnsw);
        let updatedHnsw = null;
        switch (operation) {
            case "addPoint":
                hnswInstance.addPoint(uniqueid, vector);
                updatedHnsw = hnswInstance.toJSON();
                self.postMessage({ updatedHnsw });
                break;
            case "updatePoint":
                hnswInstance.updatePoint(uniqueid, vector);
                updatedHnsw = hnswInstance.toJSON();
                self.postMessage({ updatedHnsw });
                break;
            case "syncVectorsFromCloud":
                console.log("SYNCING VECTORS FROM CLOUD");
                syncVectorsFromCloud(items, hnswInstance).then(() => {
                    updatedHnsw = hnswInstance.toJSON();
                    self.postMessage({ updatedHnsw });
                });
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }
    } catch (error) {
        console.error("Error in worker: ", error);
    }
};
