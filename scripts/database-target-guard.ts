export const previewDatabaseName='bbb_practice_preview';
export const previewDeployRole='bbb_preview_deploy_lp';

const parsed=(connection:string)=>{if(connection!==connection.trim())throw new Error('Database URL must not contain surrounding whitespace');const url=new URL(connection);if(url.protocol!=='postgresql:')throw new Error('Database URL must use PostgreSQL');return url;};
const databaseName=(url:URL)=>decodeURIComponent(url.pathname.replace(/^\//,''));

export function assertDisposableTestDatabase(connection:string,marker:string|undefined){
  const url=parsed(connection),name=databaseName(url),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(marker!=='disposable-test'||!local||name.toLowerCase()===previewDatabaseName||!/test|validation|disposable/i.test(name))throw new Error('Destructive tests require an explicitly marked local disposable test database');
}

export function assertPreviewDeployDatabase(connection:string,marker:string|undefined,expectedHost:string|undefined){
  const url=parsed(connection),host=expectedHost?.trim().toLowerCase();
  if(marker!==previewDatabaseName||!host||url.hostname.toLowerCase()!==host||databaseName(url)!==previewDatabaseName||decodeURIComponent(url.username)!==previewDeployRole||url.hostname.includes('-pooler')||url.searchParams.get('sslmode')!=='require')throw new Error('Preview deployment database guard rejected the target');
}
