export const previewDatabaseName='bbb_practice_preview';

const databaseName=(connection:string)=>decodeURIComponent(new URL(connection).pathname.replace(/^\//,''));

export function assertDisposableTestDatabase(connection:string,marker:string|undefined){
  const name=databaseName(connection);
  if(marker!=='disposable-test'||name===previewDatabaseName||!/test|validation|disposable/i.test(name))throw new Error('Destructive tests require an explicitly marked disposable test database');
}

export function assertPreviewDeployDatabase(connection:string,marker:string|undefined){
  if(marker!==previewDatabaseName||databaseName(connection)!==previewDatabaseName)throw new Error('Preview deployment database guard rejected the target');
}
