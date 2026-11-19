import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';

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

const rendererPath=new URL('../src/painted/city/safety/building-mesh-renderer.ts',import.meta.url);
const renderer=ts.createSourceFile(fileURLToPath(rendererPath),readFileSync(rendererPath,'utf8'),ts.ScriptTarget.Latest,true);
function rendererDefinition(name){
  const matches=[];
  function visit(node){
    if(ts.isFunctionDeclaration(node)&&node.name?.text===name)matches.push(node);
    ts.forEachChild(node,visit);
  }
  visit(renderer);
  assert.equal(matches.length,1,name);
  return matches[0].getText(renderer);
}

const {checkShadowAdmission,SOURCE_SHADOW_VECTOR}=await bundle(`
  import {getC312_FIXTURE} from './painted/city/safety/c312-fixture';
  import {getC320_FIXTURE} from './painted/city/safety/c320-fixture';
  import {getC322_FIXTURE} from './painted/city/safety/c322-fixture';
  import {C319_FIXTURE} from './painted/city/safety/c319-fixture';
  import {C323_FIXTURE} from './painted/city/safety/c323-fixture';
  import {cityCohortIdentity} from './painted/city/safety/city-data-metadata';
  import {SOURCE_SHADOW_VECTOR} from './painted/city/safety/source-shadow';
  export {SOURCE_SHADOW_VECTOR};
  export function checkShadowAdmission(value,context,count,scope){
    const city=context.city,currentDataScope=()=>scope,key=row=>row.objectId+'|'+row.partId;
    let c319ShadowProofReady=false,c320ShadowProofReady=false,c322ShadowProofReady=false,c323ShadowProofReady=false;
    ${rendererDefinition('c311ShadowAdmissionReady')}
    ${rendererDefinition('c312ShadowAdmissionReady')}
    return c312ShadowAdmissionReady(value,context,count);
  }
`);

function shadow(rows,boundarySHA){
  return {
    verifiedBoundarySHA256:boundarySHA,
    profile:{city:'munich',schema_version:1,source_boundary_sha256:boundarySHA,status:'display-schematic',
      includes_growth_zero_to_one:true,swept_bbox_actual_city_covered:true,fixed_vector:SOURCE_SHADOW_VECTOR},
    components:rows.map(row=>({objectId:row.objectId,partId:row.partId,
      triangleCount:row.batches.reduce((total,batch)=>total+batch.indices.length/3,0)})),
  };
}

const ordinary={city:'munich',objectId:'ordinary-building',partId:'ordinary-part',
  batches:[{positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]}]};
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
    const boundarySHA='a'.repeat(64);
    assert.equal(checkShadowAdmission(shadow([ordinary],boundarySHA),makeContext(signal,{boundarySHA}),1,scope),false);
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
    const context=makeContext(signal,fixture);
    const shadowProof=shadow(fixture.native,fixture.boundarySHA);
    assert.throws(()=>checkShadowAdmission(shadowProof,context,fixture.native.length,scope),
      /Frozen data resource was not prepared for this scope: painted\/city\/safety\/c312-fixture\.ts#0/);
    await prepareCityData(fixture.native,'munich',signal,scope);
    assert.equal(reads.filter(file=>file===C312_FIXTURE_RESOURCE.file).length,1);
    assert.equal(checkShadowAdmission(shadowProof,context,fixture.native.length,scope),true);
    const wrongTriangles=structuredClone(shadowProof);
    wrongTriangles.components[0].triangleCount++;
    assert.equal(checkShadowAdmission(wrongTriangles,context,fixture.native.length,scope),false);
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
