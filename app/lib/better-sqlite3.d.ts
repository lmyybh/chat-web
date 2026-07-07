declare module "better-sqlite3" {
  type SqliteValue = string | number | bigint | Buffer | null;

  interface Statement {
    run(...params: SqliteValue[]): { changes: number; lastInsertRowid: number | bigint };
    get<T = unknown>(...params: SqliteValue[]): T | undefined;
    all<T = unknown>(...params: SqliteValue[]): T[];
  }

  class Database {
    constructor(filename: string);
    exec(source: string): this;
    pragma(source: string): unknown;
    prepare(source: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  }

  export = Database;
}
