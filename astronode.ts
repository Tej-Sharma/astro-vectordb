export class AstroNode {
  uniqueid: string;
  level: number;
  vector: Float32Array | number[];
  neighbors: string[][]; // neighbors[level][M]
  deleted?: boolean = false;

  constructor(
    uniqueid: string,
    vector: Float32Array | number[],
    level: number,
    M: number,
    neighbors?: string[][],
    deleted: boolean = false,
  ) {
    this.uniqueid = uniqueid;
    this.vector = vector;
    this.level = level;
    // if neighbors given, initialize with that
    if (neighbors) {
      this.neighbors = neighbors;
    } else {
      // otherwise create an empty array
      // this.neighbors = Array.from({ length: level + 1 }, () =>
      //   new Array(M).fill(''),
      // );
      this.neighbors = [];
    }
    this.deleted = deleted;
  }

  toJSON(): Record<string, any> {
    return {
      uniqueid: this.uniqueid,
      level: this.level,
      vector: Array.from(this.vector),
      neighbors: this.neighbors.map((level) => Array.from(level)),
      deleted: this.deleted,
    };
  }

  /**
   * Parses a JSON object into an AstroNode
   * @param obj
   * @returns
   */
  static parse(obj: Record<string, any>): AstroNode {
    return new AstroNode(
      obj.uniqueid,
      obj.vector,
      obj.level,
      obj.M,
      obj.neighbors,
      obj.deleted,
    );
  }
}

/**
 * Extends AstroNode with a score relative to the query
 */
export class AstroNodeWithScore extends AstroNode {
  score: number;

  constructor(
    uniqueid: string,
    vector: Float32Array | number[],
    level: number,
    M: number,
    neighbors?: string[][],
    deleted: boolean = false,
    score: number = 0,
  ) {
    super(uniqueid, vector, level, M, neighbors, deleted);
    this.score = score;
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      score: this.score,
    };
  }

  /**
   * Parses a JSON object into an AstroNode
   * @param obj
   * @returns
   */
  static parse(obj: Record<string, any>): AstroNodeWithScore {
    return new AstroNodeWithScore(
      obj.uniqueid,
      obj.vector,
      obj.level,
      obj.M,
      obj.neighbors,
      obj.deleted,
      obj.score,
    );
  }
}
