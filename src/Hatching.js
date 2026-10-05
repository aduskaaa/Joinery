/** Vector section hatches, clipped against actual outlines and Boolean holes. */
(function (J) {
  "use strict";
  const { add, sub, mul, unit, dot, perpendicular, pointInPolygon } =
    J.Geometry;
  function clip(a, b, polygons) {
    const v = sub(b, a),
      ts = [0, 1];
    for (const polygon of polygons)
      for (const ring of polygon)
        for (let i = 0; i < ring.length; i++) {
          const c = ring[i],
            w = sub(ring[(i + 1) % ring.length], c),
            d = sub(c, a),
            cross = v.x * w.y - v.y * w.x;
          if (Math.abs(cross) < 1e-9) continue;
          const t = (d.x * w.y - d.y * w.x) / cross,
            u = (d.x * v.y - d.y * v.x) / cross;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
        }
    ts.sort((x, y) => x - y);
    const result = [];
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] < 1e-8) continue;
      const p = add(a, mul(v, (ts[i] + ts[i - 1]) / 2));
      if (
        polygons.some(
          (rings) =>
            pointInPolygon(p, rings[0]) &&
            !rings.slice(1).some((r) => pointInPolygon(p, r)),
        )
      )
        result.push([add(a, mul(v, ts[i - 1])), add(a, mul(v, ts[i]))]);
    }
    return result;
  }
  function primitives(e, paperScale = 1, textHoles = []) {
    const spec = e.part || e,
      material = J.Materials.kind(spec?.materialKind);
    if (
      !material || e.symbolType || (e.type === "polyline" && !e.closed) ||
      !["panel", "region", "rectangle", "polyline"].includes(e.type)
    )
      return [];
    let polygons =
        e.type === "region" ? e.polygons : [[J.Geometry.vertices(e)]],
      points = polygons.flat(2),
      stock = e.stockPoints || e.points;
    if (textHoles && textHoles.length > 0) {
      const minX = Math.min(...points.map((p) => p.x)),
        maxX = Math.max(...points.map((p) => p.x)),
        minY = Math.min(...points.map((p) => p.y)),
        maxY = Math.max(...points.map((p) => p.y));
      const relevant = textHoles.filter((ring) => {
        const rMinX = Math.min(...ring.map((p) => p.x)),
          rMaxX = Math.max(...ring.map((p) => p.x)),
          rMinY = Math.min(...ring.map((p) => p.y)),
          rMaxY = Math.max(...ring.map((p) => p.y));
        return !(rMaxX < minX || rMinX > maxX || rMaxY < minY || rMinY > maxY);
      });
      if (relevant.length > 0) {
        polygons = polygons.map((poly) => [
          poly[0],
          ...poly.slice(1),
          ...relevant,
        ]);
      }
    }
    const edges=(stock?.length>=4?stock:polygons[0][0]).map((p,i,pts)=>[p,pts[(i+1)%pts.length]])
      .sort((a,b)=>J.Geometry.distance(...b)-J.Geometry.distance(...a));
    const axis=edges.length?unit(sub(edges[0][1],edges[0][0])):{x:1,y:0},normal=perpendicular(axis);
    const lines=[], maxPrimitives=1600;
    function emit(points, extra={}) {
      if(lines.length<maxPrimitives)lines.push({kind:"path",points,thin:true,hatch:true,...extra});
    }
    function clippedPath(points,extra={}) {
      let chain=[];
      const flush=()=>{if(chain.length>1)emit(chain,extra);chain=[];};
      for(let i=1;i<points.length;i++){
        const segments=clip(points[i-1],points[i],polygons);
        if(!segments.length)flush();
        for(const [a,b] of segments){
          if(chain.length && J.Geometry.distance(chain.at(-1),a)<1e-6)chain.push(b);
          else {flush();chain=[a,b];}
        }
      }
      flush();
    }
    function family(angle,style="straight",factor=1) {
      const radians=angle*Math.PI/180, direction=add(mul(axis,Math.cos(radians)),mul(normal,Math.sin(radians))),n=perpendicular(direction),
        along=points.map(p=>dot(p,direction)),across=points.map(p=>dot(p,n)),lo=Math.min(...across),hi=Math.max(...across),u0=Math.min(...along)-paperScale,u1=Math.max(...along)+paperScale,
        spacing=Math.max(paperScale*(spec.hatchSpacing||3)*factor,(hi-lo)/300),at=(u,t)=>add(mul(direction,u),mul(n,t));
      let row=0;
      for(let t=Math.ceil(lo/spacing)*spacing;t<hi && lines.length<maxPrimitives;t+=spacing,row++){
        if(style==="wave"){
          const count=Math.min(80,Math.max(8,Math.ceil((u1-u0)/(paperScale*2)))),amplitude=Math.min(spacing*.08,paperScale*.25),wavelength=paperScale*14;
          const wave=Array.from({length:count+1},(_,i)=>{const u=u0+(u1-u0)*i/count;return at(u,t+amplitude*Math.sin(u/wavelength*2*Math.PI+row*.8));});
          clippedPath(wave);
        }else if(style==="stone"){
          const length=spacing*.9,shift=(row%2)*length;
          for(let u=u0+shift;u<u1 && lines.length<maxPrimitives;u+=length*2)clippedPath([at(u,t),at(Math.min(u+length,u1),t)]);
        }else if(style==="putty"){
          const length=paperScale*.28,shift=(row%2)*spacing*.43;
          for(let u=u0+shift;u<u1 && lines.length<maxPrimitives;u+=spacing*.75)clippedPath([at(u,t),at(u+length,t+length*(row%3-1))]);
        }else{
          clippedPath([at(u0,t),at(u1,t)]);
          if(style==="paired")clippedPath([at(u0,t+paperScale*.7),at(u1,t+paperScale*.7)]);
        }
      }
    }
    const sign=spec.hatchReverse?-1:1;
    switch(material.pattern){
      case "diagonal":family(45*sign);break;
      case "longitudinal":family(0,"wave");break;
      case "glass":family(30*sign,"paired",2.5);break;
      case "plastic":family(60);family(-60);break;
      case "rubber":family(0,"straight",.55);family(90,"straight",.55);break;
      case "stone":family(45,"stone",.7);break;
      case "putty":family(0,"putty",.65);break;
      case "insulation":family(90,"wave",.6);break;
      default:family(90);break;
    }
    // Veneer is a thin internal line; foil is a very thick face line (figs 59–61).
    const face=spec.faceLayer || (material.pattern==="laminate"?"foil":"");
    const uu=points.map(p=>dot(p,axis)),vv=points.map(p=>dot(p,normal)),a0=Math.min(...uu),a1=Math.max(...uu),v0=Math.min(...vv),v1=Math.max(...vv),
      at=(u,v)=>add(mul(axis,u),mul(normal,v));
    if(face){
      const inset=face==="veneer"?Math.min(.35*paperScale,(v1-v0)/4):paperScale*.001;
      for(const v of [v0+inset,v1-inset])clippedPath([at(a0,v),at(a1,v)],{hatch:false,materialSymbol:true,lineWeight:face==="foil"?.7:.13});
    }
    function grain(where,dir){
      if(!dir)return;
      const center=where==="face"?at((a0+a1)/2,v1+paperScale*2.5):at(a0+Math.min(paperScale*5,(a1-a0)/4),(v0+v1)/2),s=Math.min(paperScale*1.5,(v1-v0)/4);
      const point=(x,y)=>add(center,add(mul(axis,x),mul(normal,y)));
      if(dir==="cross"){
        emit([point(-s,-s),point(s,s)],{hatch:false,materialSymbol:true});
        emit([point(-s,s),point(s,-s)],{hatch:false,materialSymbol:true});
      }else{
        const a=point(-2*s,0),b=point(2*s,0);
        emit([a,b],{hatch:false,materialSymbol:true});
        emit([point(s,s*.6),b,point(s,-s*.6)],{hatch:false,materialSymbol:true});
      }
    }
    if(material.id.startsWith("blockboard"))grain("core",spec.coreDirection);
    if(face==="veneer")grain("face",spec.faceDirection);
    return lines;
  }
  J.Hatching = { primitives, clip };
})((globalThis.Joinery = globalThis.Joinery || {}));
