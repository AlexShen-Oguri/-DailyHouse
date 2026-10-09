import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateProjectedRecord } from '../src/personal/sync-projection';
import { validateSharedProjectRecord } from '../src/personal/shared-projects';

let db: PGlite;
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', session='33333333-3333-4333-8333-333333333333';
const first='44444444-4444-4444-8444-444444444444', second='55555555-5555-4555-8555-555555555555';
const key='A'.repeat(43), otherKey='B'.repeat(43);
const claims = (extra: Record<string,unknown>={}) => ({ sub:owner,role:'authenticated',session_id:session,exp:Math.floor(Date.now()/1000)+3600,...extra });
async function rpc(name: string,args: unknown[],extra: Record<string,unknown>={},role='authenticated') {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims',JSON.stringify(claims(extra))]);
  await db.exec(`set role ${role}`);
  try { return (await db.query<{result:any}>(`select public.dailyhouse_sync_${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args)).rows[0].result; }
  finally { await db.exec('reset role'); }
}
const body=(id:string,title='Synthetic task') => ({id,title,done:false,createdAt:new Date().toISOString(),dueDate:null});
const operation=(id:string,baseVersion=0,title='Synthetic task') => ({id:randomUUID(),baseVersion,action:'upsert',record:{kind:'todo',id,body:body(id,title)}});
const readingOperation=(id:string,baseVersion=0,notes='Own notes') => ({id:randomUUID(),baseVersion,action:'upsert',record:{kind:'reading',id,body:{id,title:'Synthetic paper',type:'article',url:'https://example.test/paper',sourceKey:'https://example.test/paper',notes,status:'reading',category:'science',origin:'manual',addedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}});
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    grant usage on schema public,auth to anon,authenticated; grant execute on function auth.jwt(),auth.uid() to anon,authenticated;`);
  const sql=readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261004073110_private_sync.sql',import.meta.url)),'utf8');
  try { await db.exec(sql); } catch(error:any) { throw new Error(`Migration diagnostic: ${error.message}; position=${error.position}; internal=${error.internalPosition}; ${error.where}; ${error.internalQuery || ''}`); }
},30000);
beforeEach(async()=>{
  await db.exec('reset role; truncate dailyhouse_private.operations,dailyhouse_private.records,dailyhouse_private.devices,dailyhouse_private.owner,auth.sessions,auth.users cascade');
  await db.query('insert into auth.users values ($1),($2)',[owner,other]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
  await db.query('insert into dailyhouse_private.owner(user_id) values($1)',[owner]);
  await db.query(`insert into dailyhouse_private.devices(id,name,key_hash,scopes,administrator) values($1,'Synthetic Windows',sha256(convert_to($2,'UTF8')),array['todos','reading','ideas','learning','journal','projects'],true),($3,'Synthetic Mac',sha256(convert_to($4,'UTF8')),array['todos','reading'],false)`,[first,key,second,otherKey]);
});
afterAll(async()=>{await db?.close();});

describe('isolated PostgreSQL private Supabase RPC boundary',()=>{
  it('denies anon, unallowlisted owners, expired JWTs and stale signed-out sessions',async()=>{
    await expect(rpc('pull',[first,key,['todos']],{},'anon')).rejects.toThrow(/permission denied/i);
    await expect(rpc('pull',[first,key,['todos']],{sub:other})).rejects.toThrow('Owner authentication');
    await expect(rpc('probe',[first,key],{exp:1})).rejects.toThrow('Owner authentication');
    await expect(rpc('probe',[first,key],{is_anonymous:true})).rejects.toThrow('Owner authentication');
    await db.query('delete from auth.sessions where id=$1',[session]);
    await expect(rpc('pull',[first,key,['todos']])).rejects.toThrow('Active owner session');
  });
  it('checks session expiry, random device key, scopes and revocation on every read and write',async()=>{
    await expect(rpc('probe',[first,'C'.repeat(43)])).rejects.toThrow('Device authorization');
    await expect(rpc('pull',[second,otherKey,['journal']])).rejects.toThrow('Unauthorized sync scope');
    await db.query("update auth.sessions set not_after=now()-interval '1 second'");
    await expect(rpc('probe',[first,key])).rejects.toThrow('Active owner session');
    await db.exec('update auth.sessions set not_after=null');
    await expect(rpc('revoke',[second,otherKey,first])).rejects.toThrow('administrator');
    expect(await rpc('revoke',[first,key,second])).toEqual({revoked:true});
    await expect(rpc('pull',[second,otherKey,['todos']])).rejects.toThrow('Device authorization');
    await expect(rpc('push',[second,otherKey,operation(randomUUID())])).rejects.toThrow('Device authorization');
  });
  it('has no table grants or anonymous function grants and private helpers cannot bypass checks',async()=>{
    const tables=(await db.query<{name:string;rls:boolean}>("select relname as name,relrowsecurity as rls from pg_class join pg_namespace on relnamespace=pg_namespace.oid where nspname='dailyhouse_private' and relkind='r'")).rows;
    expect(tables).toHaveLength(4); expect(tables.every(table=>table.rls)).toBe(true);
    await db.exec('set role authenticated');
    try { await expect(db.query('select * from dailyhouse_private.records')).rejects.toThrow('permission denied'); await expect(db.query('select dailyhouse_private.clean_expired()')).rejects.toThrow('permission denied'); await expect(db.query('select dailyhouse_private.next_sync_time(null)')).rejects.toThrow('permission denied'); }
    finally { await db.exec('reset role'); }
    const functions=(await db.query<{name:string;definer:boolean;config:string[]}>("select proname as name,prosecdef as definer,proconfig as config from pg_proc join pg_namespace on pronamespace=pg_namespace.oid where proname like 'dailyhouse_sync_%'")).rows;
    expect(functions).toHaveLength(5); expect(functions.every(fn=>!fn.definer && fn.config?.includes('search_path=""'))).toBe(true);
    const probe=await rpc('probe',[first,key]); expect(probe).toMatchObject({deviceId:first,name:'Synthetic Windows',administrator:true});
    const devices=await rpc('devices',[first,key]); expect(devices.items).toHaveLength(2); expect(devices.items[0]).toMatchObject({id:first,revoked:false}); expect(JSON.stringify(devices)).not.toMatch(/key_hash|AAAA/);
  });
  it('syncs two devices with CAS conflicts and keeps a new empty device from clearing records',async()=>{
    const id=randomUUID(), initial=operation(id); const created=await rpc('push',[first,key,initial]); expect(created.status).toBe('accepted'); expect(created.record).toMatchObject({version:1,sourceDeviceId:first,sourceDeviceName:'Synthetic Windows'});
    const remote=await rpc('pull',[second,otherKey,['todos']]); expect(remote).toMatchObject({complete:true}); expect(remote.items).toHaveLength(1);
    const updated=await rpc('push',[second,otherKey,operation(id,1,'Mac edit')]); expect(updated.status).toBe('accepted');
    const conflict=await rpc('push',[first,key,operation(id,1,'Offline Windows edit')]); expect(conflict).toMatchObject({status:'conflict',record:{body:{title:'Mac edit'},version:2}});
    expect((await rpc('pull',[first,key,[]])).items).toEqual([]); expect((await rpc('pull',[first,key,['todos']])).items).toHaveLength(1);
  });
  it('makes retries immutable and stores only fingerprint/result metadata without duplicate private bodies',async()=>{
    const op=operation(randomUUID()); const firstResult=await rpc('push',[first,key,op]); expect(await rpc('push',[first,key,op])).toEqual(firstResult);
    await expect(rpc('push',[first,key,{...op,record:{...op.record,body:{...op.record.body,title:'Changed retry'}}}])).rejects.toThrow('Retry cannot change');
    const operations=(await db.query<any>('select * from dailyhouse_private.operations')).rows; expect(operations).toHaveLength(1); expect(Object.keys(operations[0])).not.toContain('record'); expect(Object.keys(operations[0])).not.toContain('body');
    await rpc('push',[second,otherKey,operation(op.record.id,1,'Later edit')]); expect((await rpc('push',[first,key,op])).status).toBe('conflict');
  });
  it('propagates deletion and explicit restoration, then prevents hard-purged content from reviving',async()=>{
    const op=readingOperation(randomUUID()); await rpc('push',[first,key,op]);
    const deletedAt=new Date().toISOString(),expiresAt=new Date(Date.parse(deletedAt)+30*86400000).toISOString();
    const removed=await rpc('push',[first,key,{id:randomUUID(),baseVersion:1,action:'delete',record:{...op.record,deletedAt,expiresAt}}]); expect(removed.status).toBe('accepted');
    expect((await rpc('push',[second,otherKey,readingOperation(op.record.id,2,'Must not silently revive')])).status).toBe('conflict');
    const restored=await rpc('push',[second,otherKey,{...readingOperation(op.record.id,2),action:'restore'}]); expect(restored).toMatchObject({status:'accepted',record:{version:3}});
    await rpc('push',[first,key,{id:randomUUID(),baseVersion:3,action:'purge',record:{kind:'reading',id:op.record.id,body:null,deletedAt}}]);
    const attempt=await rpc('push',[second,otherKey,{...readingOperation(op.record.id,4),action:'restore'}]); expect(attempt.status).toBe('conflict'); expect(attempt.record.body).toBeNull();
  });
  it('strips expired content and recovery metadata while retaining the tombstone and rejecting old restore/replay',async()=>{
    const op=readingOperation(randomUUID()); await rpc('push',[first,key,op]); const expiresAt=new Date(Date.now()-1000).toISOString(),deletedAt=new Date(Date.parse(expiresAt)-30*86400000).toISOString();
    const removed={id:randomUUID(),baseVersion:1,action:'delete',record:{...op.record,deletedAt,expiresAt}}; await rpc('push',[first,key,removed]);
    const priorTime=new Date(Date.now()+60000).toISOString();
    await db.query("update dailyhouse_private.records set value=jsonb_set(value,'{syncedAt}',to_jsonb($1::text))",[priorTime]);
    const pulled=await rpc('pull',[second,otherKey,['reading']]); expect(pulled.items[0].body).toBeNull(); expect(pulled.items[0]).not.toHaveProperty('expiresAt'); expect(pulled.items[0].version).toBe(3);
    expect(Date.parse(pulled.items[0].syncedAt)).toBeGreaterThan(Date.parse(priorTime));
    expect((await rpc('push',[first,key,removed])).status).toBe('conflict'); expect((await rpc('push',[second,otherKey,{...readingOperation(op.record.id,3),action:'restore'}])).status).toBe('conflict');
  });
  it('protects live canonical reading sources against another device creating a different ID',async()=>{
    const id=randomUUID(); const reading={kind:'reading',id,body:{id,title:'Synthetic paper',type:'article',url:'https://example.test/paper',sourceKey:'https://example.test/paper',notes:'Own notes',status:'reading',category:'science',origin:'manual',addedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}};
    await rpc('push',[first,key,{id:randomUUID(),record:reading,baseVersion:0,action:'upsert'}]); const otherId=randomUUID();
    const result=await rpc('push',[second,otherKey,{id:randomUUID(),record:{...reading,id:otherId,body:{...reading.body,id:otherId,notes:'Other notes'}},baseVersion:0,action:'upsert'}]); expect(result).toMatchObject({status:'conflict',record:{id,body:{notes:'Own notes'}}});
  });
  it('accepts every projected domain with the same field shapes as local validation',async()=>{
    const now=new Date().toISOString(),id=randomUUID(),ideaId=randomUUID(),stepId=randomUUID(),date='2026-10-04';
    const snapshot={id:ideaId,title:'Synthetic source',body:'Selected authored context',updatedAt:now,sources:[]};
    const records=[
      operation(id).record,readingOperation(id).record,
      {kind:'readingReport',id:`report:tech:${date}`,body:{status:'done',hidden:false,category:'science',finishedAt:now}},
      {kind:'readingSuppression',id:'https://example.test/removed',body:{removedAt:now}},
      {kind:'readingExpired',id,body:{expiredAt:now}},
      {kind:'idea',id:ideaId,body:{id:ideaId,title:'Synthetic idea',status:'growing',createdAt:now,updatedAt:now,entries:[{id:randomUUID(),kind:'initial',content:'Selected idea',createdAt:now,updatedAt:now}]}},
      {kind:'ideaRemoved',id:ideaId,body:{removed:true}},
      {kind:'learning',id,body:{id,title:'Synthetic course',course:'CS',goal:'Learn a topic',nextStep:'Read',nextStepId:stepId,dueDate:null,status:'active',createdAt:now,updatedAt:now,entries:[{id:randomUUID(),kind:'initial',content:'Read a reference',links:[{id:randomUUID(),title:'Reference',url:'https://example.test/reading'}],nextStep:'Take notes',nextStepId:randomUUID(),createdAt:now,updatedAt:now}]}},
      {kind:'ideaMeta',id:ideaId,body:{id:ideaId,tags:['CS'],pinned:true,sources:[snapshot]}},
      {kind:'gardenProject',id,body:{id,title:'Synthetic garden project',goal:'A small project',mvp:['One screen'],acceptance:['It works'],nextStep:'Build',nextStepId:stepId,sourceBubbleId:ideaId,sourceSnapshot:snapshot,status:'active',createdAt:now,updatedAt:now}},
      {kind:'project',id,body:{id,title:'Synthetic continuation',goal:'Continue safely',decisions:'Use a single owner',progress:'Prepared locally',nextStep:'Review',repoUrl:'https://github.com/example/synthetic',sourceIdeaId:ideaId,createdAt:now,updatedAt:now}},
      {kind:'journal',id:date,body:{date,timezone:'America/New_York',title:'Synthetic day',codex:'A selected progress note',life:'',reflection:'',status:'draft',lifeState:'waiting',createdAt:now,updatedAt:now,editedFields:['title'],writer:'manual'}},
      {kind:'journalSuppression',id:date,body:{deleted:true}},
    ];
    for(const record of records){
      if(record.kind==='project') validateSharedProjectRecord(record as any); else validateProjectedRecord(record);
      expect(await rpc('push',[first,key,{id:randomUUID(),record,baseVersion:0,action:'upsert'}])).toMatchObject({status:'accepted',record:{body:record.body}});
    }
    const pulled=await rpc('pull',[first,key,['todos','reading','ideas','learning','projects','journal']]); expect(pulled.items).toHaveLength(records.length);
    for(const record of pulled.items){ const {version,sourceDeviceId,sourceDeviceName,syncedAt,...projection}=record;
      if(record.kind==='project') validateSharedProjectRecord(projection); else validateProjectedRecord(projection);
    }
  });
  it('derives source collision identity independently and rejects an unrelated client source key',async()=>{
    const op=readingOperation(randomUUID()); op.record.body.url='https://example.test/paper?a=1&b=space+value'; op.record.body.sourceKey=op.record.body.url;
    await rpc('push',[first,key,op]);
    const duplicate=readingOperation(randomUUID()); duplicate.record.body.url='https://EXAMPLE.test:443/paper?b=space%20value&utm_source=test&a=1#fragment'; duplicate.record.body.sourceKey=op.record.body.sourceKey;
    validateProjectedRecord(duplicate.record);
    expect(await rpc('push',[second,otherKey,duplicate])).toMatchObject({status:'conflict',record:{id:op.record.id}});
    const forged=readingOperation(randomUUID()); forged.record.body.sourceKey='https://example.test/unrelated';
    await expect(rpc('push',[first,key,forged])).rejects.toThrow('Unsupported sync source');
    expect((await rpc('pull',[first,key,['reading']])).items).toHaveLength(1);
  });
  it('keeps removal suppression from reviving through a different ID but permits explicit same-ID recovery',async()=>{
    const original=readingOperation(randomUUID()); await rpc('push',[first,key,original]);
    const deletedAt=new Date().toISOString(),expiresAt=new Date(Date.parse(deletedAt)+30*86400000).toISOString();
    await rpc('push',[first,key,{id:randomUUID(),record:{...original.record,deletedAt,expiresAt},baseVersion:1,action:'delete'}]);
    const marker={kind:'readingSuppression',id:original.record.body.sourceKey,body:{removedAt:deletedAt}};
    await rpc('push',[first,key,{id:randomUUID(),record:marker,baseVersion:0,action:'upsert'}]);
    expect(await rpc('push',[second,otherKey,readingOperation(randomUUID())])).toMatchObject({status:'conflict',record:{kind:'readingSuppression',id:marker.id}});
    expect(await rpc('push',[second,otherKey,{...readingOperation(randomUUID()),action:'restore'}])).toMatchObject({status:'conflict',record:{kind:'readingSuppression'}});
    expect(await rpc('push',[second,otherKey,{...readingOperation(original.record.id,2),action:'restore'}])).toMatchObject({status:'accepted',record:{kind:'reading',version:3}});
    for(const source of ['https://user:password@example.test/', 'https://example.test/?utm_source=old','https://example.test/path#fragment','HTTPS://EXAMPLE.test:443/path']){
      await expect(rpc('push',[first,key,{id:randomUUID(),record:{...marker,id:source},baseVersion:0,action:'upsert'}])).rejects.toThrow('Invalid sync record');
    }
  });
  it('removes expired nested learning-node content and advances CAS without changing authored parent timestamps',async()=>{
    const now=new Date().toISOString(),id=randomUUID(),expiresAt=new Date(Date.now()-1000).toISOString(),removedAt=new Date(Date.parse(expiresAt)-30*86400000).toISOString();
    const entry=(content:string)=>({id:randomUUID(),kind:'progress',content,links:[],nextStep:'',nextStepId:randomUUID(),createdAt:now,updatedAt:now});
    const record={kind:'learning',id,body:{id,title:'Synthetic course',course:'CS',goal:'Learn',nextStep:'Read',nextStepId:randomUUID(),dueDate:null,status:'active',createdAt:now,updatedAt:now,entries:[entry('Keep this node'),{...entry('Expired synthetic private node'),removedAt,expiresAt}]}};
    validateProjectedRecord(record);
    const op={id:randomUUID(),record,baseVersion:0,action:'upsert'}; await rpc('push',[first,key,op]);
    const result=(await rpc('pull',[first,key,['learning']])).items[0]; expect(result.version).toBe(2); expect(result.body.updatedAt).toBe(now); expect(result.body.entries).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('Expired synthetic private node');
    expect((await rpc('push',[first,key,op])).status).toBe('conflict');
    expect((await rpc('pull',[first,key,['learning']])).items[0].version).toBe(2);
  });
  it('closes the delete-before-suppression gap and requires a newer explicit marker removal to re-add',async()=>{
    const original=readingOperation(randomUUID()); await rpc('push',[first,key,original]);
    const marker={kind:'readingSuppression',id:original.record.body.sourceKey,body:null};
    await rpc('push',[first,key,{id:randomUUID(),record:marker,baseVersion:0,action:'purge'}]);
    // Force equal receipts ahead of the wall clock, as after a clock correction.
    const priorTime=new Date(Date.now()+60000).toISOString();
    await db.query("update dailyhouse_private.records set value=jsonb_set(value,'{syncedAt}',to_jsonb($1::text))",[priorTime]);
    const deleted=await rpc('push',[first,key,{id:randomUUID(),record:{kind:'reading',id:original.record.id,body:null},baseVersion:1,action:'purge'}]);
    expect(Date.parse(deleted.record.syncedAt)).toBeGreaterThan(Date.parse(priorTime));
    // Legacy equal timestamps must fail closed rather than authorize revival.
    await db.query("update dailyhouse_private.records set value=jsonb_set(value,'{syncedAt}',to_jsonb($1::text)) where kind='readingSuppression'",[deleted.record.syncedAt]);
    expect((await rpc('push',[second,otherKey,readingOperation(randomUUID())])).record).toMatchObject({kind:'reading',id:original.record.id,body:null});
    const cleared=await rpc('push',[first,key,{id:randomUUID(),record:marker,baseVersion:1,action:'purge'}]);
    expect(Date.parse(cleared.record.syncedAt)).toBeGreaterThan(Date.parse(deleted.record.syncedAt));
    const newRecord=readingOperation(randomUUID()); expect(await rpc('push',[second,otherKey,newRecord])).toMatchObject({status:'accepted',record:{id:newRecord.record.id}});
    const stored=(await db.query<{source_key:string}>('select source_key from dailyhouse_private.records where kind=$1 and id=$2',['reading',original.record.id])).rows[0]; expect(stored.source_key).toContain('example.test');
  });
  it('rejects nested unexpected fields, malformed required values and invalid recovery deadlines atomically',async()=>{
    const now=new Date().toISOString(),id=randomUUID();
    const malformed=[
      {...operation(id).record,body:{...body(id),createdAt:null}},
      {...operation(id).record,body:{...body(id),source:{kind:'reading',id,title:'Source',type:'article',url:'https://example.test',arbitraryFiles:['Synthetic private content']}}},
      {kind:'ideaMeta',id,body:{id,tags:[],pinned:false,sources:[{id,title:'Source',body:'Selected note',updatedAt:now,contacts:['Synthetic private content']}]}},
      {...readingOperation(id).record,body:{...readingOperation(id).record.body,attachmentMetadata:{id:'a'.repeat(64)+'.pdf',name:'test.pdf',size:2,mime:'application/pdf',extension:'pdf',originalFile:'Synthetic private file'}}},
      {...readingOperation(id).record,deletedAt:null,expiresAt:now},
      {...readingOperation(id).record,deletedAt:now,expiresAt:new Date(Date.parse(now)+29*86400000).toISOString()},
      {...operation(id).record,deletedAt:now,expiresAt:new Date(Date.parse(now)+30*86400000).toISOString()},
    ];
    for(const record of malformed) await expect(rpc('push',[first,key,{id:randomUUID(),record,baseVersion:0,action:'upsert'}])).rejects.toThrow();
    expect((await rpc('pull',[first,key,['todos','reading','ideas']])).items).toEqual([]); expect((await db.query('select * from dailyhouse_private.operations')).rows).toEqual([]);
    await expect(rpc('probe',[first,key],{session_id:'------------------------------------'})).rejects.toThrow('Owner authentication');
  });
  it('rejects private fields, unknown record scopes and wrong deletion intent before storage',async()=>{
    const op=operation(randomUUID()); await expect(rpc('push',[first,key,{...op,record:{...op.record,body:{...op.record.body,token:'Synthetic forbidden token'}}}])).rejects.toThrow('Unsupported sync fields');
    await expect(rpc('push',[first,key,{...op,record:{...op.record,kind:'externalConversation'}}])).rejects.toThrow('Invalid sync record');
    await expect(rpc('push',[first,key,{...op,action:'purge'}])).rejects.toThrow('Deletion intent');
    expect((await rpc('pull',[first,key,['todos']])).items).toHaveLength(0);
  });
});
