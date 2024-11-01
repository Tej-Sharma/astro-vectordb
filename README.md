# Astro: Local Vector Database in-memory in TS (without docker / server needed!)

A highly performant local vector database using HNSW with persistent storage via IndexedDB.

## Features:

-   🚀 Pure TypeScript implementation
-   💾 Persistent storage via IndexedDB
-   🌐 Runs entirely in the browser
-   📦 Just 1 dependency on `idb` (IndexedDB wrapper)
-   ⚡ Approximate Nearest Neighbor search
-   🔄 Support for dynamic updates

## Advantages:

✅ No need for docker
✅ No need for a server
✅ No need for a separate process
✅ No dependencies needed
✅ Easy to use with Electron.js, React, Svelte, etc.
✅ Just plug and play into your web app

## Usage

You can take advantage of the driver in the `driver` folder to easily start using use the library in your project.

### 1. Initialize the database

Somewhere in the beginning, call `getAstroDb` to have the DB ready for before the operations:

```
const astrodb = await getAstroDB();
```

### 2. Add data

```
// adding a point

await addToAstroDB(uniqueid, [0.5, 1.0, ...]);
```

### 3. Searching data

```
const results = await searchAstroDB(vector, max_nodes_to_get, min_similarity_strength);
```

### 4. Updating data

```
await updateVectorAstroDB(uniqueid, [0.5, 1.0, ...]);
```

### 5. Deleting data

```
await removeFromAstroDB(uniqueid);
```

### 6. Getting a single node by id

```
const node = await getSingleAstroDBNode(uniqueid);
```

### Optional Worker:

Most of the method take in an optional worker parameter to performantly execute the DB operations to prevent blocking the main thread.

### Using without the driver:

## Contributing Help Needed

These are the following areas I need help with to improve the library:

-   [ ] Graph cleaning:
    -   Running occasional graph cleaning to remove nodes that are deleted but
        being used to search other nodes by updating their neighbors to have new
        neighbors.
-   [ ] More optimizations:
    -   I'm still working on optimizing the algorithms more and second looks
        on how to improve performance would be great.

## Credits

Credits to https://github.com/deepfates/hnsw for some of the base.
On top of this, I made a lot of additions:

✅ Completely new searching algorithm
✅ Handling additions when the node's neighbors are full
✅ Some more optimizations (but much more needed)
