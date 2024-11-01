import { PriorityQueue } from "./pqueue";
import { AstroNode } from "./astronode";
import { cosineSimilarity, euclideanSimilarity } from "./similarity";

type Metric = "cosine" | "euclidean";

export class HNSW {
    metric: Metric; // Metric to use
    similarityFunction: (
        a: number[] | Float32Array,
        b: number[] | Float32Array
    ) => number;
    d: number | null = null; // Dimension of the vectors
    M: number; // Max number of neighbors
    // Max number of nodes to visit during construction and also ef for search
    efConstruction: number;
    levelMax: number; // Max level of the graph
    entryPointId: string; // Id of the entry point
    nodes: Map<string, AstroNode>; // Map of nodes
    probs: number[]; // Probabilities for the levels

    constructor(
        M = 16,
        efConstruction = 200,
        d: number | null = null,
        metric = "cosine"
    ) {
        this.metric = metric as Metric;
        this.d = d; // # of dimensions
        this.M = M;
        this.efConstruction = efConstruction;
        this.entryPointId = "";
        this.nodes = new Map<string, AstroNode>();
        this.probs = this.set_probs(M, 1 / Math.log(M));
        this.levelMax = this.probs.length - 1;
        this.similarityFunction = this.getMetric(metric as Metric);
    }

    private getMetric(
        metric: Metric
    ): (a: number[] | Float32Array, b: number[] | Float32Array) => number {
        if (metric === "cosine") {
            return cosineSimilarity;
        } else if (metric === "euclidean") {
            return euclideanSimilarity;
        } else {
            throw new Error("Invalid metric");
        }
    }

    private set_probs(M: number, levelMult: number): number[] {
        let level = 0;
        const probs = [];
        while (true) {
            const prob =
                Math.exp(-level / levelMult) * (1 - Math.exp(-1 / levelMult));
            if (prob < 1e-9) break;
            probs.push(prob);
            level++;
        }
        return probs;
    }

    /**
     *
     * @returns a random level based on the probabilities set
     */
    private selectLevel(): number {
        let r = Math.random();
        this.probs.forEach((p, i) => {
            if (r < p) {
                return i;
            }
            r -= p;
        });
        return this.probs.length - 1;
    }

    /**
     * New add node to graph based on the paper
     */
    private addNodeToGraphOptimized(
        node: AstroNode,
        nodeInsertionLevel: number
    ) {
        if (this.entryPointId === "") {
            this.entryPointId = node.uniqueid;
            return;
        }
        let foundNearestElements = new PriorityQueue<AstroNode>(
            (a, b) =>
                this.similarityFunction(node.vector, b.vector) -
                this.similarityFunction(node.vector, a.vector)
        );
        let entryPoints: AstroNode[] = [];
        const entryPointNode = this.nodes.get(this.entryPointId);
        if (entryPointNode) entryPoints.push(entryPointNode);

        for (let i = this.levelMax; i >= nodeInsertionLevel + 1; i--) {
            foundNearestElements = this.searchLayer(
                node.vector,
                entryPoints,
                1,
                i
            );
            const closestFoundElement = foundNearestElements.popFirst();
            if (closestFoundElement) {
                entryPoints = [closestFoundElement];
            }
        }

        for (let i = Math.min(this.levelMax, nodeInsertionLevel); i >= 0; i--) {
            foundNearestElements = this.searchLayer(
                node.vector,
                entryPoints,
                this.efConstruction,
                i
            );

            const closestNeighborsAtLevel: AstroNode[] =
                this.selectNeighbors(foundNearestElements);

            for (let j = 0; j < closestNeighborsAtLevel.length; j++) {
                const neighborNode = this.nodes.get(
                    closestNeighborsAtLevel[j].uniqueid
                );
                if (!neighborNode) continue;
                this.addBidirectionalConnections(node, neighborNode, i);
            }

            for (let j = 0; j < closestNeighborsAtLevel.length; j++) {
                const neighborNode = this.nodes.get(
                    closestNeighborsAtLevel[j].uniqueid
                );
                if (!neighborNode) continue;
                this.shrinkConnectionsIfNeeded(neighborNode, i);
            }

            entryPoints = foundNearestElements.toArray();
        }

        if (nodeInsertionLevel > this.levelMax) {
            this.levelMax = nodeInsertionLevel;
            console.log("LEVEL MAX INCREMENTED");
            this.entryPointId = node.uniqueid;
        }
    }

    /**
     * Add a point to the nodes and add to the graph
     * @param uniqueid
     * @param vector
     */
    addPoint(uniqueid: string, vector: Float32Array | number[]) {
        if (!vector || vector.length == 0) return;

        if (this.d !== null && vector.length !== this.d) {
            throw new Error("All vectors must be of the same dimension");
        }
        this.d = vector.length;

        const nodeInsertionLevel = this.selectLevel();

        this.nodes.set(
            uniqueid,
            new AstroNode(uniqueid, vector, nodeInsertionLevel, this.M)
        );
        const node = this.nodes.get(uniqueid)!;

        this.levelMax = Math.max(this.levelMax, node.level);

        this.addNodeToGraphOptimized(node, nodeInsertionLevel);
    }

    /**
     * Opposite of addNodeToGraph, removes a node from the graph
     * @param node
     */
    private async removeNodeFromGraph(node: AstroNode) {
        // Iterate over each level of the node's neighbors
        for (let level = 0; level <= node.level; level++) {
            // For each neighbor in that level, replace the node's uniqueid with ''
            for (const neighborId of node.neighbors[level]) {
                if (neighborId !== "") {
                    const neighborNode = this.nodes.get(neighborId);
                    if (neighborNode) {
                        // Replace the node's uniqueid with '' in each of its neighbor's lists
                        neighborNode.neighbors[level] = neighborNode.neighbors[
                            level
                        ].map((uniqueid) =>
                            uniqueid === node.uniqueid ? "" : uniqueid
                        );
                    }
                }
            }
        }

        // Finally, remove the node from the graph
        this.nodes.delete(node.uniqueid);
    }

    /**
     * Removes by marking the node as deleted so not to
     * consider it for results.
     * If it is the entrypoint node, it remains unchanged so
     * that the entrypoint node can be used to rebuild the index
     * Note: may need to set a better entrypoint node or in fact add a
     * method of rebuilding the index with a better entrypoint node at times
     * @param uniqueid node to remove
     * @returns
     */
    removePoint(uniqueid: string) {
        const node = this.nodes.get(uniqueid);
        if (!node) {
            return;
        }

        node.deleted = true;

        this.nodes.set(uniqueid, node);

        // Optionally, update the entry point if it was the node being removed
        // if (this.entryPointId === uniqueid) {
        //   this.entryPointId = ''; // Or set to another suitable node as the new entry point
        // }
    }

    /**
     * TODO: can still be improved to not added deleted notes to best candidates
     * but to still use those deleted notes to pursue search paths since those
     * deleted notes might be the best connected. Right now, eF is 200 so the likelihood
     * of not finding any notes due to there being 200 deleted notes being best candidates
     * is very low but it would be an improvement to the algorithm nonetheless
     * @param query
     * @param K
     * @param similarityStrength
     * @param ef
     * @param beam_size
     * @returns
     */
    searchKNNOptimized(
        query: Float32Array | number[],
        K: number,
        similarityStrength: number = 0.5,
        ef: number = this.efConstruction,
        beam_size: number = 10
    ) {
        if (!this.entryPointId) {
            return [];
        }

        const best_candidates = new PriorityQueue<AstroNode>(
            (a, b) =>
                this.similarityFunction(query, b.vector) -
                this.similarityFunction(query, a.vector)
        );

        let beam = [this.nodes.get(this.entryPointId)!];

        for (let level = this.levelMax; level >= 0; level--) {
            const layer_results = this.searchLayer(
                query,
                beam,
                Math.min(ef, beam_size),
                level
            );
            this.updateBestCandidates(
                query,
                best_candidates,
                layer_results.toArray(),
                Math.max(K, ef)
            );

            beam = this.getTopBeam(layer_results.toArray(), beam_size);
        }

        const bottom_layer_results = this.searchLayer(query, beam, ef, 0);

        this.updateBestCandidates(
            query,
            best_candidates,
            bottom_layer_results.toArray(),
            Math.max(K, ef)
        );

        let scoredCandidates = best_candidates
            .toArray()
            .map((node) => {
                const score = this.similarityFunction(query, node.vector);
                return { ...node, score };
            })
            .filter((node) => node.score > similarityStrength && !node.deleted);

        if (scoredCandidates.length > K) {
            scoredCandidates = scoredCandidates.slice(0, K);
        }

        return scoredCandidates;
    }

    private searchLayer(
        query: Float32Array | number[],
        entryPoints: AstroNode[],
        ef: number,
        level: number
    ) {
        const visited = new Set<string>();
        const candidates = new PriorityQueue<AstroNode>(
            (a, b) =>
                this.similarityFunction(query, b.vector) -
                this.similarityFunction(query, a.vector)
        );
        const foundNearestNeighbors = new PriorityQueue<AstroNode>(
            (a, b) =>
                this.similarityFunction(query, b.vector) -
                this.similarityFunction(query, a.vector)
        );

        for (const ep of entryPoints) {
            if (!visited.has(ep.uniqueid)) {
                visited.add(ep.uniqueid);
                candidates.push(ep);
                foundNearestNeighbors.push(ep);
            }
        }

        while (!candidates.isEmpty()) {
            // get nearest element from C to q
            const current = candidates.popFirst()!;
            // get furthest element from results to q
            let furthest = foundNearestNeighbors.getLast()!;

            // if similarity is less than furthest, break
            // no point going on, since this will keep getting
            if (
                this.similarityFunction(query, current.vector) <
                this.similarityFunction(query, furthest.vector)
            ) {
                break;
            }

            if (!current.neighbors[level]) current.neighbors[level] = [];

            // Now iterate on its neighbors, looking for elements more similar than furthest
            for (const neighborId of current.neighbors[level]) {
                if (neighborId && !visited.has(neighborId)) {
                    // add to visited
                    visited.add(neighborId);
                    // get latest furthest
                    furthest = foundNearestNeighbors.getLast()!;

                    const neighbor = this.nodes.get(neighborId)!;
                    const neighborSimilarity = this.similarityFunction(
                        query,
                        neighbor.vector
                    );

                    if (
                        foundNearestNeighbors.size() < ef ||
                        neighborSimilarity >
                            this.similarityFunction(query, furthest.vector)
                    ) {
                        candidates.push(neighbor);
                        foundNearestNeighbors.push(neighbor);

                        // If neighbors size exceeded, remove the least similar one
                        if (foundNearestNeighbors.size() > ef) {
                            foundNearestNeighbors.popLast();
                        }
                    }
                }
            }
        }
        return foundNearestNeighbors;
    }

    /**
     * Merge in new candidates and discard the furthest ones
     * Skips deleted nodes in the process
     * @param bestCandidates
     * @param newCandidates
     * @param maxSize
     */
    private updateBestCandidates(
        query: Float32Array | number[],
        bestCandidates: PriorityQueue<AstroNode>,
        newCandidates: AstroNode[],
        maxSize: number
    ) {
        // Add in all new candidates
        for (const candidate of newCandidates) {
            if (candidate.deleted) continue;
            bestCandidates.push(candidate);
        }

        // Discard the furthest ones until maxSize is reached
        while (bestCandidates.size() > maxSize) {
            bestCandidates.popLast();
        }
    }

    /**
     * Get only the top beam size candidates
     * @param candidates
     * @param beamSize
     * @returns
     */
    private getTopBeam(candidates: AstroNode[], beamSize: number): AstroNode[] {
        if (beamSize >= candidates.length) return candidates;
        return candidates.slice(0, beamSize);
    }

    /**
     * Select the top numbNeighborsToReturn
     * @param nearestNeighbors
     * @param numbNeighborsToReturn
     * @returns
     */
    private selectNeighbors(
        nearestNeighbors: PriorityQueue<AstroNode>,
        numbNeighborsToReturn = this.M
    ) {
        const nearestNeighborsArr = nearestNeighbors.toArray();
        if (numbNeighborsToReturn >= nearestNeighborsArr.length)
            return nearestNeighborsArr;
        return nearestNeighborsArr.slice(0, numbNeighborsToReturn);
    }

    /**
     * Filters out empty uniqueids in neighbors and creates bidirectional
     * links between the two nodes
     * @param nodeA
     * @param nodeB
     * @param level
     */
    private addBidirectionalConnections(
        nodeA: AstroNode,
        nodeB: AstroNode,
        level: number
    ) {
        if (!nodeA.neighbors[level]) nodeA.neighbors[level] = [];
        if (!nodeB.neighbors[level]) nodeB.neighbors[level] = [];

        nodeA.neighbors[level] = nodeA.neighbors[level].filter(
            (uniqueid) => uniqueid !== ""
        );
        nodeB.neighbors[level] = nodeB.neighbors[level].filter(
            (uniqueid) => uniqueid !== ""
        );

        if (!nodeA.neighbors[level].includes(nodeB.uniqueid)) {
            nodeA.neighbors[level].push(nodeB.uniqueid);
        }
        if (!nodeB.neighbors[level].includes(nodeA.uniqueid)) {
            nodeB.neighbors[level].push(nodeA.uniqueid);
        }
    }

    /**
     * If while adding connections, the max connections was
     * exceeded (this.M), shrink to the closest connections
     * @param node
     * @param level
     */
    private shrinkConnectionsIfNeeded(node: AstroNode, level: number) {
        let neighbors = node.neighbors[level];
        if (neighbors.length > this.M) {
            const oldNeighbors = new PriorityQueue<AstroNode>(
                (a, b) =>
                    this.similarityFunction(node.vector, b.vector) -
                    this.similarityFunction(node.vector, a.vector)
            );

            neighbors.forEach((neighborId) => {
                const neighborNode = this.nodes.get(neighborId);
                if (neighborNode) oldNeighbors.push(neighborNode);
            });

            const newNeighborNodes = this.selectNeighbors(oldNeighbors, this.M);
            const newNeighborIds = newNeighborNodes.map(
                (node) => node.uniqueid
            );
            node.neighbors[level] = newNeighborIds;

            return node;
        }

        return null;
    }

    /**
     * Update point that marks the node as deleted and adds a new point with the updated vector
     * @param uniqueid
     * @param newVector
     * @returns
     */
    updatePoint(uniqueid: string, newVector: Float32Array | number[]) {
        const node = this.nodes.get(uniqueid);
        if (!node) {
            this.addPoint(uniqueid, newVector);
            return;
        }

        // Mark the existing node as deleted
        node.deleted = true;

        this.nodes.set(uniqueid, node);

        // Add the new node with updated vector
        this.addPoint(uniqueid, newVector);

        // Optionally, implement a mechanism to rebuild the index if too many nodes are deleted
        // TODO: as users start to have thousands of deleted nodes, this will need to be implemented
        // if (this.shouldRebuildIndex()) {
        //   await this.rebuildIndex();
        // }
    }

    /**
     * Not currently being used update method that reassigns connections
     * Adapted from here though:
     * https://github.com/nmslib/hnswlib/blob/master/hnswlib/hnswalg.h
     * @param uniqueid
     * @param vector
     * @returns
     */
    updatePointReassign(uniqueid: string, newVector: Float32Array | number[]) {
        const result = this.findNodeAndIncomingConnections(uniqueid, newVector);
        if (!result) {
            // Node not found, add as new point
            this.addPoint(uniqueid, newVector);
            return;
        }
        const node = this.nodes.get(uniqueid)!;

        console.log("INCOMING CONNECTIONS: ", result.incomingConnections);

        const { incomingConnections } = result;

        // Reassign connections and shrink if necessary
        this.reassignConnections(node, incomingConnections);

        // Remove the old node
        this.nodes.delete(uniqueid);

        // Add the new node with updated vector
        this.addPoint(uniqueid, newVector);
    }

    findNodeAndIncomingConnections(
        targetId: string,
        targetVector: Float32Array | number[]
    ) {
        if (!this.entryPointId) {
            return null;
        }

        const incomingConnections = new Map<number, Set<string>>();
        const visited = new Set<string>();
        let beam = [this.nodes.get(this.entryPointId)!];
        let targetNode: AstroNode | null = null;

        for (let level = this.levelMax; level >= 0; level--) {
            const layerResults = this.searchLayerForNode(
                targetId,
                targetVector,
                beam,
                level,
                incomingConnections,
                visited
            );

            if (layerResults.found && !targetNode) {
                targetNode = layerResults.node;
            }

            beam = this.getTopBeam(
                layerResults.candidates,
                Math.max(10, this.efConstruction)
            );
        }

        if (!targetNode) {
            return null; // Node not found
        }

        // Perform a limited additional search for incoming connections
        // Currently not being used for performance reasons
        // await this.findLimitedAdditionalConnections(
        //   targetNode,
        //   incomingConnections,
        //   visited,
        // );

        return { node: targetNode, incomingConnections };
    }

    private searchLayerForNode(
        targetId: string,
        targetVector: Float32Array | number[],
        entryPoints: AstroNode[],
        level: number,
        incomingConnections: Map<number, Set<string>>,
        visited: Set<string>
    ) {
        const candidates = new PriorityQueue<AstroNode>(
            (a, b) =>
                this.similarityFunction(targetVector, b.vector) -
                this.similarityFunction(targetVector, a.vector)
        );

        let found = false;
        let foundNode: AstroNode | null = null;

        for (const ep of entryPoints) {
            if (!visited.has(ep.uniqueid)) {
                visited.add(ep.uniqueid);
                candidates.push(ep);
            }
        }

        while (!candidates.isEmpty()) {
            const current = candidates.popFirst()!;

            if (current.uniqueid === targetId) {
                found = true;
                foundNode = current;
            }

            if (!current.neighbors[level]) current.neighbors[level] = [];

            for (const neighborId of current.neighbors[level]) {
                if (neighborId && !visited.has(neighborId)) {
                    visited.add(neighborId);
                    const neighbor = this.nodes.get(neighborId)!;

                    candidates.push(neighbor);

                    if (!incomingConnections.has(level)) {
                        incomingConnections.set(level, new Set());
                    }
                    incomingConnections.get(level)!.add(current.uniqueid);

                    if (neighborId === targetId) {
                        found = true;
                        foundNode = neighbor;
                    }
                }
            }

            // Limit the number of explored candidates per layer
            if (candidates.size() > this.efConstruction * 2) {
                break;
            }
        }

        return { found, node: foundNode, candidates: candidates.toArray() };
    }

    private async findLimitedAdditionalConnections(
        targetNode: AstroNode,
        incomingConnections: Map<number, Set<string>>,
        visited: Set<string>
    ) {
        const maxExplorations = this.efConstruction * 2;
        let explorations = 0;

        const queue = new PriorityQueue<AstroNode>(
            (a, b) =>
                this.similarityFunction(targetNode.vector, b.vector) -
                this.similarityFunction(targetNode.vector, a.vector)
        );

        queue.push(this.nodes.get(this.entryPointId)!);

        while (!queue.isEmpty() && explorations < maxExplorations) {
            const current = queue.popFirst()!;
            explorations++;

            for (let level = 0; level <= current.level; level++) {
                if (!current.neighbors[level]) continue;

                for (const neighborId of current.neighbors[level]) {
                    if (neighborId === targetNode.uniqueid) {
                        if (!incomingConnections.has(level)) {
                            incomingConnections.set(level, new Set());
                        }
                        incomingConnections.get(level)!.add(current.uniqueid);
                    } else if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        const neighbor = this.nodes.get(neighborId)!;
                        queue.push(neighbor);
                    }
                }
            }
        }
    }

    private reassignConnections(
        node: AstroNode,
        incomingConnections: Map<number, Set<string>>
    ) {
        for (let level = 0; level <= node.level; level++) {
            if (!node.neighbors[level]) continue;

            for (const neighborId of node.neighbors[level]) {
                const neighborNode = this.nodes.get(neighborId)!;

                // Remove the connection to the node being updated
                neighborNode.neighbors[level] = neighborNode.neighbors[
                    level
                ].filter((id) => id !== node.uniqueid);

                // Find the closest neighbor of the node to the current neighbor from incoming connections
                let closestNeighbor: AstroNode | null = null;
                let maxSimilarity = -Infinity;

                const incomingNodesAtLevel =
                    incomingConnections.get(level) || new Set<string>();
                for (const incomingNodeId of incomingNodesAtLevel) {
                    if (incomingNodeId === neighborId) continue;
                    const incomingNode = this.nodes.get(incomingNodeId)!;
                    const similarity = this.similarityFunction(
                        neighborNode.vector,
                        incomingNode.vector
                    );

                    if (similarity > maxSimilarity) {
                        maxSimilarity = similarity;
                        closestNeighbor = incomingNode;
                    }
                }

                // Connect the neighbor and the closest incoming neighbor
                if (closestNeighbor) {
                    if (
                        !neighborNode.neighbors[level].includes(
                            closestNeighbor.uniqueid
                        )
                    ) {
                        neighborNode.neighbors[level].push(
                            closestNeighbor.uniqueid
                        );
                    }
                    if (
                        !closestNeighbor.neighbors[level].includes(
                            neighborNode.uniqueid
                        )
                    ) {
                        closestNeighbor.neighbors[level].push(
                            neighborNode.uniqueid
                        );
                    }
                }
            }
        }

        // Remove the node from all incoming connections
        for (const [level, incomingNodeIds] of incomingConnections) {
            for (const incomingNodeId of incomingNodeIds) {
                const incomingNode = this.nodes.get(incomingNodeId)!;
                incomingNode.neighbors[level] = incomingNode.neighbors[
                    level
                ].filter((id) => id !== node.uniqueid);
            }
        }
    }

    buildIndex(data: { uniqueid: string; vector: Float32Array | number[] }[]) {
        // Clear existing index
        this.nodes.clear();
        this.levelMax = 0;
        this.entryPointId = "";

        // Add points to the index
        for (const item of data) {
            this.addPoint(item.uniqueid, item.vector);
        }
    }

    toJSON() {
        const entries = Array.from(this.nodes.entries());
        return {
            M: this.M,
            efConstruction: this.efConstruction,
            levelMax: this.levelMax,
            entryPointId: this.entryPointId,
            nodes: entries.map(([uniqueid, node]) => {
                return [uniqueid, node.toJSON()];
            }),
        };
    }

    static fromJSON(json: any): HNSW {
        const hnsw = new HNSW(json.M, json.efConstruction);
        hnsw.levelMax = json.levelMax;
        hnsw.entryPointId = json.entryPointId;
        hnsw.nodes = new Map(
            json.nodes.map(([uniqueid, node]: [number, any]) => {
                return [
                    uniqueid,
                    AstroNode.parse({
                        ...node,
                        vector: new Float32Array(node.vector),
                    }),
                ];
            })
        );
        return hnsw;
    }
}
