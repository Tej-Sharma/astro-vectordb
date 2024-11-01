import { HNSW } from "./hnsw";
import { openDB, deleteDB, DBSchema, IDBPDatabase } from "idb";

interface HNSWDB extends DBSchema {
    "hnsw-index": {
        key: string;
        value: any;
    };
}

export class AstroVault extends HNSW {
    dbName: string;
    db: IDBPDatabase<HNSWDB> | null = null;

    private constructor(M: number, efConstruction: number, dbName: string) {
        super(M, efConstruction);
        this.dbName = dbName;
    }

    static async create(M: number, efConstruction: number, dbName: string) {
        const instance = new AstroVault(M, efConstruction, dbName);
        await instance.initDB();
        return instance;
    }

    private async initDB() {
        this.db = await openDB<HNSWDB>(this.dbName, 1, {
            upgrade(db) {
                db.createObjectStore("hnsw-index");
            },
        });
    }

    async saveIndex() {
        if (!this.db) {
            throw new Error("Database is not initialized");
            return;
        }
        await this.db.put("hnsw-index", this.toJSON(), "hnsw");
    }

    /**
     * Loads in the data from the stored database and constructs the graph
     */
    async loadIndex() {
        if (!this.db) {
            throw new Error("No saved HNSW index found");
        }

        const loadedHNSW: AstroVault | undefined = await this.db.get(
            "hnsw-index",
            "hnsw"
        );

        if (!loadedHNSW) {
            throw new Error("No saved HNSW index found");
        }

        // Update this HNSW instance with loaded data
        const hnsw = AstroVault.fromJSON(loadedHNSW);

        this.M = hnsw.M;
        this.efConstruction = hnsw.efConstruction;
        this.levelMax = hnsw.levelMax;
        this.entryPointId = hnsw.entryPointId;
        this.nodes = hnsw.nodes;

        return hnsw?.nodes?.size ? hnsw.nodes.size : 0;
    }

    updateIndex(newHnsw: JSON) {
        const hnsw = AstroVault.fromJSON(newHnsw);

        this.M = hnsw.M;
        this.efConstruction = hnsw.efConstruction;
        this.levelMax = hnsw.levelMax;
        this.entryPointId = hnsw.entryPointId;
        this.nodes = hnsw.nodes;

        return hnsw?.nodes?.size ? hnsw.nodes.size : 0;
    }

    /**
     * When a new vault version is released that has a new graph building algorithm,
     * this function will be called to rebuild the graph nodes to restructure the graph
     */
    async rebuildGraphNodes(progressCallback?: (progress: number) => void) {
        const oldNodes = Array.from(this.nodes.values());
        this.nodes.clear();
        this.entryPointId = "";
        const totalNodes = oldNodes.length;

        const processNode = async (index: number) => {
            if (index >= oldNodes.length) {
                if (progressCallback) progressCallback(100);
                return;
            }

            const node = oldNodes[index];
            if (!node.deleted && node.uniqueid && node.vector) {
                await this.addPoint(node.uniqueid, node.vector);
            }

            if (progressCallback) {
                progressCallback(((index + 1) / totalNodes) * 100);
            }

            // Schedule the next node processing
            setTimeout(() => processNode(index + 1), 0);
        };

        // Start processing nodes
        processNode(0);

        // Return a promise that resolves when all nodes are processed
        return new Promise<void>((resolve) => {
            const checkCompletion = () => {
                if (
                    this.nodes.size === oldNodes.length ||
                    this.nodes.size ===
                        oldNodes.filter(
                            (n) => !n.deleted && n.uniqueid && n.vector
                        ).length
                ) {
                    resolve();
                } else {
                    setTimeout(checkCompletion, 2000);
                }
            };
            checkCompletion();
        });
    }

    async deleteIndex() {
        if (!this.db) {
            // console.error('Database is not initialized');
            return;
        }

        try {
            await deleteDB(this.dbName);
            this.initDB();
        } catch (error) {
            // console.error('Failed to delete index:', error);
        }
    }
}
