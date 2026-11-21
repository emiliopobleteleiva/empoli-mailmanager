export type Row = Record<string, unknown>;

/**
 * Fake mínimo de D1 para tests. Entiende SELECT/FROM/WHERE, INSERT ... VALUES,
 * UPDATE ... SET y DELETE para las consultas simples que usan las rutas.
 */
export class FakeStatement {
  constructor(
    private readonly db: FakeDb,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new FakeStatement(this.db, this.sql, params);
  }

  async all() {
    return { results: this.db.select(this.sql, this.params) };
  }

  async first() {
    return this.db.select(this.sql, this.params)[0] ?? null;
  }

  async run() {
    this.db.execute(this.sql, this.params);
    return { success: true };
  }
}

export class FakeDb {
  readonly tables: Record<string, Row[]> = {
    people: [],
    tasks: [],
    updates: [],
    attachments: [],
    recurring_series: [],
    recurring_notices: [],
    pilot_notices: [],
  };

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows;
  }

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]) {
    for (const statement of statements) await statement.run();
    return [];
  }

  select(sql: string, params: unknown[]): Row[] {
    const table = sql.match(/FROM\s+(\w+)/i)?.[1];
    if (!table) throw new Error(`SELECT no soportado: ${sql}`);

    let rows = [...(this.tables[table] ?? [])];
    const where = sql.match(
      /\bWHERE\b([\s\S]*?)(?:\bORDER BY\b|\bLIMIT\b|$)/i,
    )?.[1];
    if (where) {
      let index = 0;
      const conditions = [...where.matchAll(/(\w+)\s*=\s*\?/g)].map(
        (match) => ({ column: match[1], value: params[index++] }),
      );
      rows = rows.filter((row) =>
        conditions.every(
          (condition) => row[condition.column] === condition.value,
        ),
      );
    }
    return rows;
  }

  execute(sql: string, params: unknown[]) {
    const insert = sql.match(
      /INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]*)\)/i,
    );
    if (insert) {
      const [, table, rawColumns, rawValues] = insert;
      const columns = rawColumns.split(",").map((column) => column.trim());
      const values = rawValues.split(",").map((value) => value.trim());
      const row: Row = {};
      let paramIndex = 0;
      columns.forEach((column, index) => {
        const token = values[index];
        if (token === "?") row[column] = params[paramIndex++];
        else if (token.startsWith("'")) row[column] = token.slice(1, -1);
        else row[column] = Number.isNaN(Number(token)) ? token : Number(token);
      });
      (this.tables[table] ??= []).push(row);
      return;
    }

    const remove = sql.match(/DELETE FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
    if (remove) {
      const [, table, column] = remove;
      this.tables[table] = (this.tables[table] ?? []).filter(
        (row) => row[column] !== params[0],
      );
      return;
    }

    const update = sql.match(
      /UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+(\w+)\s*=\s*\?/i,
    );
    if (update) {
      const [, table, setClause, whereColumn] = update;
      const assignments = [
        ...setClause.matchAll(/(\w+)\s*=\s*(\?|'(?:[^']*)')/g),
      ].map((match) => ({
        column: match[1],
        token: match[2],
      }));
      let paramIndex = 0;
      const values = assignments.map(({ token }) => {
        if (token === "?") return params[paramIndex++];
        return token.slice(1, -1);
      });
      const whereValue = params[paramIndex];
      const row = (this.tables[table] ?? []).find(
        (candidate) => candidate[whereColumn] === whereValue,
      );
      if (row) {
        assignments.forEach(({ column }, index) => {
          row[column] = values[index];
        });
      }
      return;
    }

    throw new Error(`SQL no soportado: ${sql}`);
  }
}
