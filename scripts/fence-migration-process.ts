import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export type MigrationFailure =
  | 'MIGRATION_SUBPROCESS_START_FAILED'
  | 'MIGRATION_SUBPROCESS_SIGNALLED'
  | 'MIGRATION_TIMEOUT'
  | 'MIGRATION_CONNECTION_FAILED'
  | 'MIGRATION_TLS_FAILED'
  | 'MIGRATION_SQL_FAILED'
  | 'MIGRATION_CONFIGURATION_FAILED'
  | 'MIGRATION_HISTORY_FAILED'
  | 'MIGRATION_ENGINE_FAILED'
  | 'MIGRATION_UNKNOWN_FAILED';

export class MigrationProcessError extends Error {
  constructor(readonly classification: MigrationFailure) {
    super(classification);
    this.name='MigrationProcessError';
  }
}

const prismaFailures: Readonly<Record<string,MigrationFailure>> = {
  P1000:'MIGRATION_CONNECTION_FAILED', P1001:'MIGRATION_CONNECTION_FAILED',
  P1002:'MIGRATION_TIMEOUT', P1003:'MIGRATION_CONNECTION_FAILED',
  P1008:'MIGRATION_TIMEOUT', P1010:'MIGRATION_CONNECTION_FAILED',
  P1011:'MIGRATION_TLS_FAILED', P1017:'MIGRATION_CONNECTION_FAILED',
  P1012:'MIGRATION_CONFIGURATION_FAILED', P1013:'MIGRATION_CONFIGURATION_FAILED',
  P2010:'MIGRATION_SQL_FAILED',
  P3015:'MIGRATION_CONFIGURATION_FAILED', P3019:'MIGRATION_CONFIGURATION_FAILED',
  P3009:'MIGRATION_HISTORY_FAILED', P3018:'MIGRATION_SQL_FAILED',
};

function classify(output: string): MigrationFailure {
  // eslint-disable-next-line no-control-regex -- Remove intentional ANSI ESC color sequences.
  const plain=output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
  // Only recognize the CLI's error header, never arbitrary embedded code tokens.
  const header=plain.match(/^Error:[ \t]*([^\r\n]*)/m)?.[1];
  const code=header?.match(/^(P[0-9]{4})\b/)?.[1];
  if(code) return prismaFailures[code]??'MIGRATION_UNKNOWN_FAILED';
  if(header?.startsWith('Schema engine exited.') || (!header && /^Schema engine exited\./m.test(plain)))return 'MIGRATION_ENGINE_FAILED';
  return 'MIGRATION_UNKNOWN_FAILED';
}

type MigrationSpawner = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export async function runFenceMigration(
  strictUrl: string,
  env: NodeJS.ProcessEnv,
  launch: MigrationSpawner = spawn,
): Promise<void> {
  return runPrismaProcess(strictUrl,env,['exec','prisma','migrate','deploy'],undefined,launch);
}

export const prismaProbeSql = `SELECT 1 / CASE
  WHEN current_database() = 'bbb_practice_preview'
   AND current_user = 'bbb_preview_deploy_lp'
  THEN 1 ELSE 0
END;`;

export async function runReadOnlyPrismaProbe(
  strictUrl: string,
  env: NodeJS.ProcessEnv,
  launch: MigrationSpawner = spawn,
): Promise<void> {
  return runPrismaProcess(strictUrl,env,
    ['exec','prisma','db','execute','--schema','prisma/schema.prisma','--stdin'],prismaProbeSql,launch);
}

async function runPrismaProcess(
  strictUrl:string,env:NodeJS.ProcessEnv,args:string[],input:string|undefined,launch:MigrationSpawner,
):Promise<void> {
  await new Promise<void>((resolve,reject)=>{
    let timedOut=false, started=false, processError=false, unreadable=false, truncated=false;
    let inputWritten=input===undefined;
    let stdout=Buffer.alloc(0), stderr=Buffer.alloc(0);
    // Mirror the existing subprocess deadline. Node still performs the kill.
    const deadline=setTimeout(()=>{timedOut=true;},120_000);
    let child:ChildProcess;
    try {
      child=launch('pnpm',args,{
        cwd:process.cwd(),
        env:{PATH:env.PATH,HOME:env.HOME,DATABASE_URL:strictUrl},
        stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],timeout:120_000,
      });
    } catch {
      clearTimeout(deadline);
      reject(new MigrationProcessError('MIGRATION_SUBPROCESS_START_FAILED'));
      return;
    }
    const capture=(current:Buffer,chunk:Buffer)=>{
      const available=32_768-current.length;
      if(chunk.length>available)truncated=true;
      return Buffer.concat([current,chunk.subarray(0,available)]);
    };
    child.stdout?.on('data',(chunk:Buffer)=>{stdout=capture(stdout,chunk);});
    child.stderr?.on('data',(chunk:Buffer)=>{stderr=capture(stderr,chunk);});
    child.stdout?.on('error',()=>{unreadable=true;});
    child.stderr?.on('error',()=>{unreadable=true;});
    child.once('spawn',()=>{started=true;});
    child.once('error',()=>{processError=true;});
    if(input!==undefined) {
      child.stdin?.on('error',()=>{unreadable=true;});
      child.stdin?.end(input,()=>{inputWritten=true;});
    }
    child.once('close',(code:number|null,signal:NodeJS.Signals|null)=>{
      clearTimeout(deadline);
      let failure:MigrationFailure|undefined;
      if(timedOut)failure='MIGRATION_TIMEOUT';
      else if(processError)failure=started?'MIGRATION_UNKNOWN_FAILED':'MIGRATION_SUBPROCESS_START_FAILED';
      else if(signal)failure='MIGRATION_SUBPROCESS_SIGNALLED';
      else if(input!==undefined && (!inputWritten||unreadable||truncated))failure='MIGRATION_UNKNOWN_FAILED';
      else if(code!==0)failure=truncated||unreadable
        ? 'MIGRATION_UNKNOWN_FAILED'
        : classify(stderr.toString('utf8')+'\n'+stdout.toString('utf8'));
      stdout=Buffer.alloc(0);
      stderr=Buffer.alloc(0);
      if(failure)reject(new MigrationProcessError(failure));
      else resolve();
    });
  });
}
