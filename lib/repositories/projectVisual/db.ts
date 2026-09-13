import { Pool, type PoolClient, type QueryResultRow } from "@neondatabase/serverless";

export interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(text:string, params?:unknown[]):Promise<T[]>;
}
export interface TransactionExecutor extends QueryExecutor {
  transaction<T>(work:(tx:QueryExecutor)=>Promise<T>):Promise<T>;
}
class PoolQueryExecutor implements TransactionExecutor {
  constructor(private readonly pool:Pool){}
  async query<T extends QueryResultRow>(text:string,params:unknown[]=[]):Promise<T[]> {
    return (await this.pool.query<T>(text,params)).rows;
  }
  async transaction<T>(work:(tx:QueryExecutor)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();
    try{await client.query("BEGIN");const result=await work(new ClientQueryExecutor(client));await client.query("COMMIT");return result;}
    catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  }
}
export class ClientQueryExecutor implements QueryExecutor {
  constructor(private readonly client:PoolClient){}
  async query<T extends QueryResultRow>(text:string,params:unknown[]=[]):Promise<T[]> {
    return (await this.client.query<T>(text,params)).rows;
  }
}
export type NeonProjectVisualDatabase=TransactionExecutor&{close():Promise<void>};
export function createProjectVisualDatabase(connectionString:string):NeonProjectVisualDatabase{
  if(!connectionString)throw new Error("DATABASE_URL is required for the Neon Project Visual repository");
  const pool=new Pool({connectionString});const executor=new PoolQueryExecutor(pool);
  return{query:executor.query.bind(executor),transaction:executor.transaction.bind(executor),close:()=>pool.end()};
}
export function projectVisualDatabaseFromEnv():NeonProjectVisualDatabase{
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured; SQLite fallback is disabled for Project Visual repositories");
  return createProjectVisualDatabase(connectionString);
}
