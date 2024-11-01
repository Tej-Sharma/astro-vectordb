export class PriorityQueue<T> {
  private items: T[] = [];

  /**
   * Constructs a PriorityQueue with a custom comparison function.
   * @param compare A function that takes two items of type T and returns a number.
   *                If the result is less than 0, item a is considered to have a higher priority than item b.
   *                If the result is 0, items a and b are considered to have the same priority.
   *                If the result is greater than 0, item b is considered to have a higher priority than item a.
   */
  constructor(private compare: (a: T, b: T) => number) {}

  /**
   * Adds an item to the queue such that the queue remains sorted (i.e.
   * highest priority first)
   * @param item number
   */
  push(item: T) {
    let i = 0;
    while (i < this.items.length && this.compare(item, this.items[i]) > 0) {
      i++;
    }
    this.items.splice(i, 0, item);
  }

  popFirst(): T | undefined {
    return this.items.shift();
  }

  popLast(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  // TODO: if empty, what happens?
  getLast(): T | undefined {
    return this.items[this.items.length - 1];
  }

  toArray(): T[] {
    return this.items;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}
