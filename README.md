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
✅ Highly performant and reliable using HNSW
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

## Why HNSW?

It has the following advantages:

-   **Fast search:** For my applications and machine, it's almost instantaneous.
-   **Simplicity**: The core concept is easy to understand and implement.
-   **Much better reliability:** While not having the highest precision, since there are multiple levels and multiple neighbors, there is a low chance of a node getting lost. There are many paths to reach it and multiple searches on each level.

It does have the following disadvantages though:

-   **Build time:** It takes longer to build the index than other methods. This is great if your application is one where the data builds up slowly OR if you don't care too much about build time
-   **Memory usage:** It does use a bit more memory than other methods but I haven't benchmarked this too much yet as my applications require <100k vectors.

## Which vectorizer to use?

I highly recommend using the local HF vectorizer here: [Transformers.js](https://github.com/huggingface/transformers.js)

The code for it comes out to be just:

```
const { pipeline } = await import('@xenova/transformers')
const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const res = await pipe(text, { pooling: 'mean', normalize: true })
```

## Credits

Of course, the original paper on HNSW: [arXiv:1603.09320](https://arxiv.org/abs/1603.09320) **[cs.DS]**

Credits to https://github.com/deepfates/hnsw for some of the base.

On top of this, I made a lot of additions:

✅ Completely new searching algorithm
✅ Handling additions when the node's neighbors are full
✅ Some more optimizations (but much more needed)

## MIT License

Copyright (c) [2024] [Tej-Sharma]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
