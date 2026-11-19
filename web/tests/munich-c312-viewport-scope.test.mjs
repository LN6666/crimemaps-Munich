import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const source = fileURLToPath(new URL('../src/',import.meta.url));

async function bundle(contents){
  const result=await build({
    stdin:{contents,resolveDir:source,sourcefile:'munich-c312-scope-test.ts',loader:'ts'},
    bundle:true,write:false,format:'esm',platform:'node',
    plugins:[{
      name:'test-city-profile',setup(builder){
        builder.onResolve({filter:/^virtual:crimemaps-city-data$/},()=>({path:'profile',namespace:'test-city-profile'}));
        builder.onLoad({filter:/^profile$/,namespace:'test-city-profile'},()=>({contents:'export default null;'}));
      },
    }],
  });
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}

const {c312Commit,prepareCityData,C312_FIXTURE_RESOURCE,CITY_DATA_COHORTS,createFrozenDataScope}=await bundle(`
  export {c312Commit} from './painted/city/safety/munich-display-additions';
  export {prepareCityData} from './painted/city/safety/city-prepared-data';
  export {C312_FIXTURE_RESOURCE} from './painted/city/safety/c312-fixture';
  export {CITY_DATA_COHORTS} from './painted/city/safety/city-data-metadata';
  export {createFrozenDataScope} from './safety/frozen-data-scope';
`);

function newScope(fixture){
  const reads=[];
  const scope=createFrozenDataScope({
    async acquire(ref){
      reads.push(ref.file);
      const c312=ref.file===C312_FIXTURE_RESOURCE.file;
      if(c312)assert(fixture);
      const value=c312?fixture:{};
      return {logicalBytes:0,borrow:read=>read(value),release(){}};
    },
    dispose(){},
  });
  return {scope,reads};
}

const ordinary={city:'munich',objectId:'ordinary-building',partId:'ordinary-part',
  batches:[{positions:[0,0,0,1,0,0,0,1,0]}]};
const makeContext=(signal,fixture={})=>({
  city:'munich',signal,indexSHA:fixture.indexSHA,sourcePBF:fixture.sourcePBF,
  boundarySHA:fixture.boundarySHA,sourceSnapshot:fixture.sourceSnapshot,
  leafSHA:row=>row.proof?.sourceSHA256,materialReady:()=>true,
  pathsReady:{color:true,shadow:true,pick:true},
});

test('the ordinary Munich viewport commits with a cold C312 scope',async()=>{
  const signal=new AbortController().signal;
  const {scope,reads}=newScope();
  try{
    await prepareCityData([ordinary],'munich',signal,scope);
    assert(!reads.includes(C312_FIXTURE_RESOURCE.file));
    const result=c312Commit([ordinary],makeContext(signal),()=>assert.fail('Unrelated batch was tested'),scope);
    assert.equal(result.ready,false);
    assert.equal(result.sourceOnly,true);
    assert.equal(result.wholeParentHidden,false);
    assert.deepEqual(result.rows,[ordinary]);
    assert.deepEqual(result.sidecar.attributes,new Float32Array(12));
    assert(!reads.includes(C312_FIXTURE_RESOURCE.file));
  }finally{scope.release();}
});

test('the admitted C312 cohort still checks the actual fixture and included batches',async()=>{
  const {C312_FIXTURE:fixture}=await bundle("export {C312_FIXTURE} from './safety/c312-fixture';");
  const {scope,reads}=newScope(fixture);
  const signal=new AbortController().signal;
  try{
    const identity=({city,objectId,partId})=>({city,objectId,partId});
    assert.deepEqual(fixture.native.map(identity),CITY_DATA_COHORTS.c312.native);
    assert.deepEqual(fixture.added.map(identity),CITY_DATA_COHORTS.c312.added);
    await prepareCityData(fixture.native,'munich',signal,scope);
    assert.equal(reads.filter(file=>file===C312_FIXTURE_RESOURCE.file).length,1);
    const context=makeContext(signal,fixture);
    const rows=[...fixture.native,...fixture.added,ordinary];
    const result=c312Commit(rows,context,row=>row!==ordinary,scope);
    assert.equal(result.ready,true);
    assert.equal(result.sidecar.enabled,true);
    assert.equal(result.wholeParentHidden,false);
    assert.deepEqual(result.rows.map(identity),rows.map(identity));
    assert(result.sidecar.attributes.some(value=>value!==0));
    const excluded=c312Commit(rows,context,row=>row!==fixture.native[0],scope);
    assert.equal(excluded.ready,false);
    assert.equal(excluded.sidecar.enabled,false);
    assert.deepEqual(excluded.rows,[...fixture.native,ordinary]);
    const wrongSource=c312Commit(rows,{...context,leafSHA:()=>undefined},()=>true,scope);
    assert.equal(wrongSource.ready,false);
    assert.deepEqual(wrongSource.rows,[...fixture.native,ordinary]);
  }finally{scope.release();}
});
