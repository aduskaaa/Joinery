/** Drawing symbols transcribed from the user's woodworking reference, tables 1–5. */
(function(J){
  'use strict';
  const G=J.Geometry;
  const grits=Object.freeze([16,20,24,30,36,46,60,70,80,100,120,150,200,240,280,320]);
  const treatments=Object.freeze([
    ['SU','Surové provedení'],['NTP','Transparentní – přírodní'],['NTM','Transparentní – mořený'],
    ['NTB','Transparentní – bělený'],['NPJ','Pigmentový – jednobarevný'],['NPF','Pigmentový – fládrový'],['VO','Voskování'],
  ].map(([id,name])=>({id,name:`${name} (${id})`})));
  const gloss=Object.freeze([['1','Vysokolesklý'],['2','Lesklý'],['3','Pololesklý'],['4','Polomatný'],['5','Matný']].map(([id,name])=>({id,name:`${id} – ${name}`})));
  const fasteners=Object.freeze([
    ['nail-joiner','Hřebík kolářský','H','cap','none','ČSN 02 2820',2,14],
    ['nail-decor','Hřebík ozdobný','H','cap','none','PN',0.8,16],
    ['nail','Hřebík ostatní','H','cap','none','ČSN 02 2825',2,45],
    ['staple','Sponka','S','staple','none','ČSN 02 2867',2,30],
    ['screw-round','Vrut – půlkulatá hlava','V','cap','open','ČSN 02 1812',2,16],
    ['screw-countersunk','Vrut – zápustná hlava','V','countersunk','solid','ČSN 02 1814',3,25],
    ['screw-lens','Vrut – čočkovitá hlava','V','countersunk','open','ČSN 02 1815',3,25],
    ['screw-square','Vrut – čtyřhranná hlava','V','cap','open','ČSN 02 1810',5,30],
    ['screw-hex','Vrut – šestihranná hlava','V','cap','solid','ČSN 02 1810',6,40],
    ['bolt-round','Šroub – půlkulatá hlava','M','cap','none','ČSN 02 1146',2,16],
    ['bolt-cylinder','Šroub – válcová hlava','M','cap','none','ČSN 02 1131',6,45],
    ['bolt-hex','Šroub – šestihranná hlava','M','cap','none','ČSN 02 1101',3,16],
    ['bolt-square','Šroub – čtyřhranná hlava','M','cap','none','ČSN 02 1352',3,16],
    ['dowel','Kolík','K Ø','cap','none','',8,35],
  ].map(([id,name,code,head,tip,standard,diameter,length])=>Object.freeze({id,name,code,head,tip,standard,diameter,length})));
  const fastener=id=>fasteners.find(f=>f.id===id);
  const format=value=>String(value??'').trim().replace(/(\d)\.(\d)/g,'$1,$2').replace(/\s*[x×]\s*/g,' × ');
  function designation(options){
    const o=options;
    if(o.notation==='material') return J.Materials.mark({materialKind:o.markKind,woodSpecies:o.woodSpecies,markSize:format(o.markSize)});
    if(o.notation==='veneer') return [o.woodSpecies,format(o.markSize)].filter(Boolean).join(' ');
    if(o.notation==='finish'){
      const code=o.treatment==='custom'?o.text:o.treatment;
      const suffix=code==='SU'?'':o.gloss||'';
      const finish=code+suffix+(o.allFaces?'/X':'');
      return [[o.woodSpecies,format(o.markSize)].filter(Boolean).join(' '),finish].filter(Boolean).join(' - ');
    }
    if(o.notation==='fastener'){
      const f=fastener(o.fastenerId);
      return f?`${f.code}${format(o.diameter)} × ${format(o.nominalLength)}${o.standard?' '+o.standard:''}`:'';
    }
    return o.text||'';
  }
  function fields(o){
    const base=[['notation','Označení','text','select',[
      ['text','Vlastní text'],['material','Materiál'],['veneer','Dýha'],['finish','Povrchová úprava'],['fastener','Spojovací prostředek'],
    ]]];
    const woods=['woodSpecies','Dřevina','','select',[['','Neurčeno'],...J.Materials.species.map(s=>[s.id,s.name])]];
    if(o.notation==='material')base.push(['markKind','Materiál','particleboard','select',J.Materials.kinds.map(k=>[k.id,k.name])],woods,['markSize','Rozměr ve značce','','text']);
    else if(o.notation==='veneer')base.push(woods,['markSize','Tloušťka dýhy [mm]','0,7','text']);
    else if(o.notation==='finish'){
      base.push(woods,['markSize','Rozměr ve značce','','text'],['treatment','Úprava','NTP','select',[...treatments.map(t=>[t.id,t.name]),['custom','Úplný popis']]]);
      if(o.treatment==='custom')base.push(['text','Úplný popis','Popis','text']);
      else if(o.treatment!=='SU')base.push(['gloss','Lesk','5','select',gloss.map(t=>[t.id,t.name])]);
      base.push(['allFaces','Všechny plochy /X',false,'checkbox']);
    }else if(o.notation==='fastener')base.push(
      ['fastenerId','Prostředek','screw-countersunk','select',fasteners.map(f=>[f.id,f.name])],
      ['diameter','Průměr [mm]',3],['nominalLength','Délka [mm]',25],['standard','Předpis / katalog','ČSN 02 1814','text'],
    );else base.push(['text','Text','Popis','text']);
    return base;
  }
  function defaults(o,key){
    if(key==='fastenerId'){
      const f=fastener(o.fastenerId);o.diameter=f.diameter;o.nominalLength=f.length;o.standard=f.standard;
    }
    return ['notation','treatment','fastenerId','fastenerView'].includes(key);
  }
  function primitives(e,{paperScale=1,textHeight=2.5}={}){
    const a=e.points[0],u=G.unit(G.sub(e.points[1],a)),n=G.perpendicular(u),s=paperScale;
    const at=(x,y)=>G.add(a,G.add(G.mul(u,x),G.mul(n,y)));
    const path=(points,extra={})=>({kind:'path',points,thin:true,...extra});
    if(e.symbolType==='roughness')return [
      path([at(-1.4*s,2.42*s),a,at(2.8*s,4.85*s)]),
      {kind:'text',p:G.add(a,{x:0,y:5.7*s}),text:String(e.grit),size:textHeight*s,anchor:'center',annotation:true},
    ];
    const f=fastener(e.fastenerId),b=e.points[1];if(!f)return [];
    if(e.fastenerView==='end'){
      if(f.head==='staple')return [path([at(-s,-2*s),at(-s,2*s)]),path([at(s,-2*s),at(s,2*s)]),path([at(-s,0),at(s,0)])];
      return [path([at(-2*s,0),at(2*s,0)]),path([at(0,-2*s),at(0,2*s)])];
    }
    if(e.fastenerView==='axis')return [path([a,b],{lineStyle:'dashdot'})];
    const length=G.distance(a,b),r=1.4*s,list=[];
    if(f.head==='staple'){
      const curve=Array.from({length:13},(_,i)=>{const t=Math.PI/2+i*Math.PI/12;return at(r+Math.cos(t)*r,Math.sin(t)*r)});
      list.push(path([at(length,r),...curve,at(length,-r)]));
    }else{
      list.push(path([a,b]));
      list.push(f.head==='countersunk'?path([at(-s,-r),at(s,0),at(-s,r)]):path([at(0,-r),at(0,r)]));
      if(f.tip!=='none'){
        const tip=[at(length-3*s,.65*s),b,at(length-3*s,-.65*s)];
        list.push(path(tip,f.tip==='solid'?{closed:true,fill:'solid'}:{}));
      }
    }
    if(e.showFastenerLabel)list.push({kind:'text',p:G.add(G.midpoint(a,b),{x:0,y:3*s}),text:designation({...e,notation:'fastener',diameter:e.diameter,nominalLength:e.nominalLength}),size:textHeight*s,anchor:'center',annotation:true});
    return list;
  }
  function materialLabel(e,paperScale,textHeight=2.5){
    const spec=e.part||e,value=J.Materials.mark(spec);
    if(!spec.showMaterialLabel||!value)return null;
    const polygons=e.type==='region'?e.polygons:[[G.vertices(e)]], b=G.bounds([e]),size=textHeight*paperScale;
    const candidates=[G.midpoint(b.min,b.max),...polygons.map(p=>G.midpoint(G.bounds([{type:'polyline',points:p[0]}]).min,G.bounds([{type:'polyline',points:p[0]}]).max))];
    for(const center of candidates){
      const label={kind:'text',p:{x:center.x,y:center.y-size*.35},text:value,size,anchor:'center',annotation:true,materialLabel:true};
      const box=J.Scene.textBox(label,paperScale),ring=[{x:box.minX,y:box.minY},{x:box.maxX,y:box.minY},{x:box.maxX,y:box.maxY},{x:box.minX,y:box.maxY}];
      if(ring.every(p=>G.pointInRegion(p,polygons)) && !polygons.some(poly=>poly.slice(1).some(hole=>hole.some(p=>G.pointInPolygon(p,ring)))))return label;
    }
    return null;
  }
  function validate(e){
    const spec=e.part||e;
    for(const key of ['markSize'])if(spec[key]!=null&&(typeof spec[key]!=='string'||spec[key].length>120))throw new Error('Neplatný rozměr ve značce.');
    if(spec.woodSpecies && !J.Materials.species.some(w=>w.id===spec.woodSpecies))throw new Error('Neplatná značka dřeviny.');
    for(const k of ['showMaterialLabel','hatchReverse'])if(spec[k]!=null&&typeof spec[k]!=='boolean')throw new Error('Neplatné nastavení šraf.');
    if(spec.hatchSpacing!=null&&(!Number.isFinite(spec.hatchSpacing)||spec.hatchSpacing<.5||spec.hatchSpacing>20))throw new Error('Rozteč šraf musí být 0,5 až 20 mm na papíře.');
    for(const k of ['faceDirection','coreDirection'])if(spec[k]!=null&&!['','long','cross'].includes(spec[k]))throw new Error('Neplatný směr vláken.');
    if(spec.faceLayer!=null&&!['','veneer','foil'].includes(spec.faceLayer))throw new Error('Neplatná krycí vrstva.');
    if(!e.symbolType)return;
    if(e.type!=='polyline'||e.closed||e.points?.length!==2||!['roughness','fastener'].includes(e.symbolType))throw new Error('Neplatná výkresová značka.');
    if(e.symbolType==='roughness'&&!grits.includes(e.grit))throw new Error('Neplatná zrnitost opracování.');
    if(e.symbolType==='fastener'){
      if(!fastener(e.fastenerId)||!['side','end','axis'].includes(e.fastenerView)||![e.diameter,e.nominalLength].every(n=>Number.isFinite(n)&&n>0&&n<=100000))throw new Error('Neplatný spojovací prostředek.');
      if(e.standard!=null&&(typeof e.standard!=='string'||e.standard.length>120))throw new Error('Neplatný předpis spojovacího prostředku.');
      if(e.showFastenerLabel!=null&&typeof e.showFastenerLabel!=='boolean')throw new Error('Neplatné označení spojovacího prostředku.');
    }
  }
  J.Markings={grits,treatments,gloss,fasteners,fastener,designation,fields,defaults,primitives,materialLabel,validate};
})((globalThis.Joinery=globalThis.Joinery||{}));
