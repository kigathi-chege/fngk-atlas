import ts from 'typescript';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SOURCE_EXT = new Set(['.js','.jsx','.mjs','.cjs','.ts','.tsx','.svelte','.py','.php','.go']);
const IGNORE = new Set(['.git','node_modules','vendor','dist','build','.svelte-kit','coverage','.next','.cache','target']);
const BRANCH_KINDS = new Set([
  ts.SyntaxKind.IfStatement,ts.SyntaxKind.ForStatement,ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,ts.SyntaxKind.WhileStatement,ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,ts.SyntaxKind.CatchClause,ts.SyntaxKind.ConditionalExpression
]);
const digest = value => createHash('sha256').update(value).digest('hex').slice(0,20);
const normalize = value => value.split(path.sep).join('/');
const idFor = (root,kind,key) => `${kind}:${digest(`${root}\0${key}`)}`;

async function walk(root,maxFiles=6000) {
  const files=[]; const stack=[root];
  while(stack.length && files.length<maxFiles) {
    const dir=stack.pop(); let entries;
    try { entries=await fs.readdir(dir,{withFileTypes:true}); } catch { continue; }
    for(const entry of entries) {
      if(entry.isSymbolicLink() || IGNORE.has(entry.name)) continue;
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()) stack.push(file);
      else if(SOURCE_EXT.has(path.extname(entry.name).toLowerCase()) || ['package.json','composer.json','composer.lock','go.mod','requirements.txt','pyproject.toml'].includes(entry.name)) files.push(file);
      if(files.length>=maxFiles) break;
    }
  }
  return files;
}

function functionName(node,source) {
  if(node.name?.getText) return node.name.getText(source);
  const p=node.parent;
  if(ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) return p.name?.getText(source) ?? '<anonymous>';
  if(ts.isCallExpression(p)) {
    const route=p.arguments?.[1]===node || p.arguments?.[2]===node;
    if(route && p.arguments?.[0]) return `${p.expression.getText(source)} ${p.arguments[0].getText(source).replaceAll(/['"`]/g,'')}`;
  }
  return '<anonymous>';
}
function scriptKind(ext){return ext==='.tsx'?ts.ScriptKind.TSX:ext==='.jsx'?ts.ScriptKind.JSX:ext==='.js'||ext==='.mjs'||ext==='.cjs'?ts.ScriptKind.JS:ts.ScriptKind.TS;}
function analyzeTs(text,file,root) {
  const ext=path.extname(file); let script=text;
  if(ext==='.svelte') script=[...text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
  const source=ts.createSourceFile(file,script,ts.ScriptTarget.Latest,true,scriptKind(ext));
  const functions=[];
  function visit(node,parentQualified='') {
    const isFn=ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node)||ts.isFunctionExpression(node)||ts.isArrowFunction(node)||ts.isConstructorDeclaration(node)||ts.isGetAccessorDeclaration(node)||ts.isSetAccessorDeclaration(node);
    let qualified=parentQualified;
    if(isFn) {
      const name=ts.isConstructorDeclaration(node)?'constructor':functionName(node,source);
      const startPosition=source.getLineAndCharacterOfPosition(node.getStart(source));
      const line=startPosition.line+1,column=startPosition.character+1;
      const endLine=source.getLineAndCharacterOfPosition(node.end).line+1;
      qualified=parentQualified?`${parentQualified}.${name}`:name;
      let branches=0,statements=0,maxDepth=0; const calls=[];
      const body=node.body;
      const scan=(child,depth=0)=>{
        if(child!==node && (ts.isFunctionLike(child))) return;
        if(BRANCH_KINDS.has(child.kind)) branches++;
        if(ts.isBinaryExpression(child)&&(child.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken||child.operatorToken.kind===ts.SyntaxKind.BarBarToken||child.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken))branches++;
        if(ts.isStatement(child)) statements++;
        if(ts.isCallExpression(child)) calls.push(child.expression.getText(source).slice(0,160));
        const next=BRANCH_KINDS.has(child.kind)?depth+1:depth; maxDepth=Math.max(maxDepth,next);
        ts.forEachChild(child,c=>scan(c,next));
      }; if(body)scan(body);
      const params=node.parameters.map(p=>({name:p.name.getText(source),optional:Boolean(p.questionToken||p.initializer),rest:Boolean(p.dotDotDotToken),type:p.type?.getText(source)??null}));
      const modifiers=node.modifiers?.map(m=>m.getText(source))??[];
      functions.push({name,qualifiedName:qualified,kind:ts.SyntaxKind[node.kind],line,column,endLine,physicalLines:endLine-line+1,executableLines:Math.max(1,statements),statements,complexity:branches+1,maxNesting:maxDepth,parameters:params,arity:params.length,requiredArity:params.filter(p=>!p.optional&&!p.rest).length,async:modifiers.includes('async'),exported:modifiers.includes('export'),calls:[...new Set(calls)],language:ext==='.svelte'?'Svelte':'TypeScript/JavaScript'});
    }
    ts.forEachChild(node,child=>visit(child,qualified));
  }
  visit(source);
  return functions;
}

const PY_SCRIPT = String.raw`
import ast,json,sys
p=sys.argv[1]
try:
 s=open(p,encoding='utf-8',errors='replace').read(); t=ast.parse(s)
except Exception as e:
 print(json.dumps({'error':str(e),'functions':[]})); raise SystemExit
out=[]
class V(ast.NodeVisitor):
 def __init__(self): self.stack=[]
 def f(self,n,k):
  q='.'.join(self.stack+[n.name]); branches=sum(isinstance(x,(ast.If,ast.For,ast.AsyncFor,ast.While,ast.Try,ast.IfExp,ast.Match,ast.comprehension,ast.BoolOp)) for x in ast.walk(n)); calls=[]
  for x in ast.walk(n):
   if isinstance(x,ast.Call):
    try: calls.append(ast.unparse(x.func))
    except: pass
  a=n.args; ps=[{'name':x.arg,'optional':False,'rest':False,'type':ast.unparse(x.annotation) if x.annotation else None} for x in a.posonlyargs+a.args]
  defaults=len(a.defaults)
  if defaults:
   for x in ps[-defaults:]: x['optional']=True
  if a.vararg: ps.append({'name':a.vararg.arg,'optional':True,'rest':True,'type':None})
  ps += [{'name':x.arg,'optional':True,'rest':False,'type':ast.unparse(x.annotation) if x.annotation else None} for x in a.kwonlyargs]
  if a.kwarg: ps.append({'name':a.kwarg.arg,'optional':True,'rest':True,'type':None})
  out.append({'name':n.name,'qualifiedName':q,'kind':k,'line':n.lineno,'column':getattr(n,'col_offset',0)+1,'endLine':getattr(n,'end_lineno',n.lineno),'physicalLines':getattr(n,'end_lineno',n.lineno)-n.lineno+1,'executableLines':sum(isinstance(x,ast.stmt) for x in ast.walk(n)),'statements':sum(isinstance(x,ast.stmt) for x in ast.walk(n)),'complexity':1+branches,'maxNesting':0,'parameters':ps,'arity':len(ps),'requiredArity':sum(not x['optional'] for x in ps),'async':isinstance(n,ast.AsyncFunctionDef),'exported':not n.name.startswith('_'),'calls':list(dict.fromkeys(calls)),'language':'Python'})
  self.stack.append(n.name); self.generic_visit(n); self.stack.pop()
 def visit_FunctionDef(self,n): self.f(n,'FunctionDef')
 def visit_AsyncFunctionDef(self,n): self.f(n,'AsyncFunctionDef')
V().visit(t); print(json.dumps({'functions':out}))
`;
async function analyzePython(file) {
  return new Promise(resolve=>{const p=spawn('python3',['-c',PY_SCRIPT,file],{stdio:['ignore','pipe','ignore']});let out='';p.stdout.on('data',d=>out+=d);p.on('close',()=>{try{resolve(JSON.parse(out).functions??[])}catch{resolve([])}});p.on('error',()=>resolve([]));});
}
function analyzeLexical(text,ext) {
  const functions=[]; const lines=text.split(/\r?\n/);
  const pattern=ext==='.go'?/^\s*func\s+(?:\([^)]*\)\s*)?([\w$]+)\s*\(([^)]*)\)/:/^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*function\s+&?\s*([\w$]+)\s*\(([^)]*)\)/;
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(pattern);if(!m)continue;let depth=0,end=i,started=false,branches=0;
    for(let j=i;j<lines.length;j++){for(const c of lines[j]){if(c==='{'){depth++;started=true}else if(c==='}')depth--;}branches+=(lines[j].match(/\b(if|for|foreach|while|case|catch)\b|&&|\|\|/g)||[]).length;end=j;if(started&&depth<=0)break;}
    const params=m[2].trim()?m[2].split(',').map(value=>{const raw=value.trim(),parts=raw.split(/\s+/);return ext==='.go'?{name:parts[0]?.replace(/^\.\.\./,''),optional:false,rest:raw.includes('...'),type:parts.slice(1).join(' ')||null}:{name:parts.at(-1)?.replace(/^&?\$/,''),optional:raw.includes('='),rest:raw.includes('...'),type:parts.slice(0,-1).join(' ')||null};}):[];
    const bodyLines=lines.slice(i,end+1).filter(line=>{const value=line.trim();return value&&value!=='{'&&value!=='}'&&!value.startsWith('//')&&!value.startsWith('*');}).length;
    functions.push({name:m[1],qualifiedName:m[1],kind:ext==='.go'?'GoFunc':'PhpFunction',line:i+1,endLine:end+1,physicalLines:end-i+1,executableLines:bodyLines,statements:Math.max(1,bodyLines-1),complexity:branches+1,maxNesting:0,parameters:params,arity:params.length,requiredArity:params.filter(p=>!p.optional&&!p.rest).length,async:false,exported:ext==='.go'?/^[A-Z]/.test(m[1]):true,calls:[],language:ext==='.go'?'Go':'PHP',analysisConfidence:'structural'});
  }
  return functions;
}

async function packageInfo(file,root) {
  const name=path.basename(file); const rel=normalize(path.relative(root,path.dirname(file)))||'.';
  try {
    if(name==='package.json'){const p=JSON.parse(await fs.readFile(file,'utf8'));return {ecosystem:'npm',name:p.name??rel,version:p.version??null,path:rel,dependencies:{runtime:p.dependencies??{},development:p.devDependencies??{},peer:p.peerDependencies??{},optional:p.optionalDependencies??{}}};}
    if(name==='composer.json'){const p=JSON.parse(await fs.readFile(file,'utf8'));return {ecosystem:'Composer',name:p.name??rel,version:p.version??null,path:rel,dependencies:{runtime:p.require??{},development:p['require-dev']??{}}};}
    if(name==='go.mod'){const t=await fs.readFile(file,'utf8');const module=t.match(/^module\s+(\S+)/m)?.[1]??rel;const deps={runtime:{}};for(const m of t.matchAll(/^\s*([^\s()]+)\s+(v\S+)(\s+\/\/ indirect)?$/gm))deps.runtime[m[1]]=m[2]+(m[3]?' indirect':'');return {ecosystem:'Go modules',name:module,version:null,path:rel,dependencies:deps};}
    if(name==='pyproject.toml'||name==='requirements.txt')return {ecosystem:'Python',name:rel,version:null,path:rel,dependencies:{runtime:{}}};
  } catch {}
  return null;
}

export async function analyze(root,options={}) {
  root=path.resolve(root); const stat=await fs.stat(root); if(!stat.isDirectory())throw new Error('Analysis root must be a directory');
  const files=await walk(root,options.maxFiles??6000); const packages=(await Promise.all(files.map(f=>packageInfo(f,root)))).filter(Boolean);
  const packageFor=rel=>packages.filter(p=>rel===p.path||rel.startsWith(p.path==='.'?'':`${p.path}/`)).sort((a,b)=>b.path.length-a.path.length)[0];
  const nodes=[{id:idFor(root,'repo',root),type:'repository',label:path.basename(root),path:root,root,parent:null,metrics:{files:0,functions:0}}],edges=[]; const repoId=nodes[0].id; const symbolByName=new Map();
  for(const pkg of packages){pkg.id=idFor(root,'package',`${pkg.ecosystem}:${pkg.path}`);nodes.push({id:pkg.id,type:'package',label:pkg.name,path:pkg.path,parent:repoId,ecosystem:pkg.ecosystem,version:pkg.version,dependencies:pkg.dependencies});edges.push({id:`contains:${repoId}:${pkg.id}`,source:repoId,target:pkg.id,type:'contains'});for(const [scope,items] of Object.entries(pkg.dependencies))for(const [name,version] of Object.entries(items)){const depId=idFor(root,'external',`${pkg.ecosystem}:${name}`);if(!nodes.some(n=>n.id===depId))nodes.push({id:depId,type:'external',label:name,parent:null,ecosystem:pkg.ecosystem,version});edges.push({id:`dep:${pkg.id}:${depId}:${scope}`,source:pkg.id,target:depId,type:'depends_on',scope});}}
  const sourceFiles=files.filter(f=>SOURCE_EXT.has(path.extname(f).toLowerCase()));
  for(const file of sourceFiles){const rel=normalize(path.relative(root,file));const ext=path.extname(file).toLowerCase();let text;try{text=await fs.readFile(file,'utf8')}catch{continue}let fns=[];if(['.js','.jsx','.mjs','.cjs','.ts','.tsx','.svelte'].includes(ext))fns=analyzeTs(text,file,root);else if(ext==='.py')fns=await analyzePython(file);else fns=analyzeLexical(text,ext);const pkg=packageFor(normalize(path.dirname(rel)));const moduleId=idFor(root,'module',rel);nodes.push({id:moduleId,type:'module',label:path.basename(rel),path:rel,parent:pkg?.id??repoId,language:fns[0]?.language??ext.slice(1),metrics:{lines:text.split(/\r?\n/).length,functions:fns.length}});edges.push({id:`contains:${pkg?.id??repoId}:${moduleId}`,source:pkg?.id??repoId,target:moduleId,type:'contains'});for(const fn of fns){fn.id=idFor(root,'function',`${rel}:${fn.qualifiedName}:${fn.line}:${fn.column??1}`);fn.type='function';fn.label=fn.name;fn.path=rel;fn.parent=moduleId;fn.execution=executionEligibility(fn,ext);nodes.push(fn);edges.push({id:`contains:${moduleId}:${fn.id}`,source:moduleId,target:fn.id,type:'contains'});for(const key of [fn.name,fn.qualifiedName]){const list=symbolByName.get(key)??[];list.push(fn);symbolByName.set(key,list);}}}
  for(const fn of nodes.filter(n=>n.type==='function'))for(const call of fn.calls??[]){const name=call.split('.').at(-1)?.replace(/[^\w$].*$/,'');const targets=[...new Map((symbolByName.get(name)??[]).map(target=>[target.id,target])).values()];if(targets.length===1)edges.push({id:`calls:${fn.id}:${targets[0].id}`,source:fn.id,target:targets[0].id,type:'calls',confidence:'resolved-name'});}
  nodes[0].metrics={files:sourceFiles.length,functions:nodes.filter(n=>n.type==='function').length,packages:packages.length};
  const fingerprint=digest(nodes.map(n=>`${n.id}:${n.physicalLines??''}:${n.complexity??''}`).join('|'));
  return {id:repoId,root,fingerprint,nodes,edges,summary:{...nodes[0].metrics,languages:[...new Set(nodes.filter(n=>n.type==='module').map(n=>n.language))],generatedAt:new Date().toISOString()}};
}
function executionEligibility(fn,ext){if(['.mjs','.js','.cjs','.py'].includes(ext)&&fn.name!=='<anonymous>')return {state:'arguments_or_fixture',reason:'A generated external harness can attempt this symbol; imports and application context are validated at run time.'};return {state:'analyzed_only',reason:`No safe disposable harness provider is enabled for ${fn.language}.`};}
