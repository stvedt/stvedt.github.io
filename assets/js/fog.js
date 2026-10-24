// Volumetric fog: two WebGL2 layers raymarched through 3D noise, one behind the type and one drifting over it.
// Every 7-10s the front layer carries a wisp of fog across the center, over the name and links.
(() => {
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const vs=`#version 300 es
in vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }`;
// Raymarch a slab of 3D noise between zA and zB, front-to-back, output premultiplied.
const fs=(STEPS)=>`#version 300 es
precision highp float;
uniform vec2 R; uniform float T; uniform vec2 M; uniform vec2 V;
uniform vec4 VP;   // visible viewport inside the canvas (x,y,w,h px); the canvas can overhang it under mobile browser bars
uniform vec3 W;    // wisp: center in uv, strength
uniform float zA,zB,gain,backlit,clearAmt,jitAmt;
out vec4 o;
float h3(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.x+p.y)*p.z); }
float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float v=0.,a=.5; for(int k=0;k<4;k++){ v+=a*n3(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5; } return v; }
float dens(vec3 p){
  vec3 q=p*vec3(.9,1.25,.9);
  q+=vec3(T*.11,-T*.014,T*.05);              // drift: sideways roll with slow churn in depth
  float w=fbm(q*.45+vec3(0.,0.,T*.035));
  float d=fbm(q+vec3(w*1.6,w*.5,w*.8));
  d=smoothstep(.42,.9,d);
  d*=mix(1.1,.7,smoothstep(-.6,.7,p.y));     // fog pools low
  return d;
}
void main(){
  float aspect=VP.z/VP.w;
  vec2 uv=(gl_FragCoord.xy-VP.xy-.5*VP.zw)/VP.w;
  vec2 m=(M-.5)*vec2(aspect,1.);
  float jit=mix(.5,h3(vec3(gl_FragCoord.xy,fract(T)*61.)),jitAmt);
  vec2 dm=uv-m; float near=exp(-dot(dm,dm)*7.);
  // Clear black center, fog thickens toward the screen edges. Narrow screens weight the top and bottom more,
  // start the falloff sooner and add a base haze so the edges never read as empty.
  vec2 q=(gl_FragCoord.xy-VP.xy)/VP.zw*2.-1.;
  float narrow=1.-clamp(aspect,0.,1.);
  float edge=smoothstep(.3-.12*narrow,.95-.2*narrow,length(q*vec2(clamp(aspect,.5,1.),1.)));
  float haze=edge*edge*.14*narrow;
  vec2 dw=(uv-W.xy)/vec2(.9,.3); float wm=W.z*exp(-dot(dw,dw));   // soft horizontal band
  vec3 col=vec3(0.); float acc=0.;
  float dz=(zB-zA)/${STEPS}.;
  for(int i=0;i<${STEPS};i++){
    float z=zA+dz*(float(i)+jit);
    vec3 p=vec3(uv*(.6+z*.55),z*1.3);
    p.xy-=m*.10/z;                         // parallax: near fog shifts more
    p.xy-=V*near*(.9/z);                   // wake from cursor motion
    float n=dens(p);
    float d=(n+haze)*gain*mix(.06,1.6+.9*narrow,edge);
    d*=1.-clearAmt*near;                   // breath of clear air around the cursor
    d+=wm*(n*2.4+.45)*2.;                // wisp is shaped by the same noise so it reads as fog, not a blob
    float a=1.-exp(-d*dz*2.4);
    float depth=exp(-(z-.3)*.38);
    float glow=backlit*edge*.7;             // light the outer fog, not the center
    vec3 c=vec3(.70,.71,.72)*(.16+.5*min(d,1.))*depth+vec3(.95,.93,.88)*glow*min(d,1.)*.42;
    col+=(1.-acc)*a*c; acc+=(1.-acc)*a;
  }
  col+=(h3(vec3(gl_FragCoord.xy,T))-.5)*.012*acc*jitAmt;
  o=vec4(col,acc);
}`;

function layer(id,opt){
  const cv=document.getElementById(id);
  const gl=cv.getContext('webgl2',{antialias:false,premultipliedAlpha:true,alpha:true});
  if(!gl) return null;
  const sh=(t,s)=>{const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);
    if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x;};
  const pr=gl.createProgram();
  gl.attachShader(pr,sh(gl.VERTEX_SHADER,vs));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,fs(opt.steps)));gl.linkProgram(pr);gl.useProgram(pr);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const l=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
  const U=n=>gl.getUniformLocation(pr,n);
  gl.uniform1f(U('zA'),opt.zA);gl.uniform1f(U('zB'),opt.zB);gl.uniform1f(U('gain'),opt.gain);
  gl.uniform1f(U('backlit'),opt.backlit);gl.uniform1f(U('clearAmt'),opt.clear);gl.uniform1f(U('jitAmt'),opt.jit);
  const uR=U('R'),uT=U('T'),uM=U('M'),uV=U('V'),uVP=U('VP'),uW=U('W');
  return {
    resize(){ const s=Math.min(devicePixelRatio||1,2)*opt.res, cw=cv.clientWidth, ch=cv.clientHeight;
      cv.width=Math.max(2,Math.round(cw*s)); cv.height=Math.max(2,Math.round(ch*s)); gl.viewport(0,0,cv.width,cv.height);
      // The canvas overhangs the viewport evenly, so the visible area sits centered inside it.
      gl.uniform4f(uVP,(cw-innerWidth)/2*s,(ch-innerHeight)/2*s,innerWidth*s,innerHeight*s); },
    draw(t,m,v,w){ gl.uniform2f(uR,cv.width,cv.height);gl.uniform1f(uT,t);gl.uniform2f(uM,m.x,m.y);gl.uniform2f(uV,v.x,v.y);gl.uniform3f(uW,w.x,w.y,w.a);gl.drawArrays(gl.TRIANGLES,0,3); }
  };
}

let back,front;
try{
  back =layer('back', {steps:14,zA:1.0,zB:4.2,gain:1.0,backlit:.9,clear:.25,res:.5,jit:0});
  front=layer('front',{steps:8,zA:.32,zB:.95,gain:.55,backlit:.15,clear:.85,res:.7,jit:0});
}catch(e){console.error(e);}
if(!back){document.body.classList.add('no-fog');return;}

let T=30;
const m={x:.5,y:.45,tx:.5,ty:.45}, v={x:0,y:0}; let lx=null,ly=null,lt=0;
function resize(){back.resize();front&&front.resize();frame();}
const noWisp={x:0,y:0,a:0}, wisp={x:0,y:0,a:0,t:-1,dir:1,y0:0,next:T+4};
function frame(){back.draw(T,m,v,noWisp);front&&front.draw(T,m,v,wisp);}
// A wisp starts every 7-10s, crosses the center over 5.5s and fades in and out on the way.
function stepWisp(){
  if(wisp.t<0&&T>=wisp.next){wisp.t=T;wisp.dir=Math.random()<.5?-1:1;wisp.y0=-.12+Math.random()*.18;wisp.next=T+7+Math.random()*3;}
  if(wisp.t<0)return;
  const u=(T-wisp.t)/5.5;
  if(u>=1){wisp.t=-1;wisp.a=0;return;}
  const span=Math.min(innerWidth/innerHeight,1.6)*.5+.4;
  wisp.x=wisp.dir*(u*2-1)*span; wisp.y=wisp.y0+(u-.5)*.04; wisp.a=Math.sin(Math.PI*u)**2;
}
addEventListener('pointermove',e=>{
  const nx=e.clientX/innerWidth, ny=1-e.clientY/innerHeight, now=performance.now();
  if(lx!==null){const dt=Math.max(16,now-lt)/1000; const a=innerWidth/innerHeight;
    v.x+=((nx-lx)*a/dt*.06-v.x)*.25; v.y+=((ny-ly)/dt*.06-v.y)*.25;}
  lx=nx;ly=ny;lt=now;m.tx=nx;m.ty=ny;
  if(reduce){m.x=nx;m.y=ny;frame();}
});
addEventListener('resize',resize);
resize();
if(!reduce){
  let last=performance.now();
  const loop=now=>{const dt=Math.min(.05,(now-last)/1000);last=now;T+=dt;
    const k=1-Math.exp(-dt*1.2);                // cursor eases in over about a second
    m.x+=(m.tx-m.x)*k; m.y+=(m.ty-m.y)*k;
    const d=Math.exp(-dt*.9); v.x*=d; v.y*=d;   // wake settles slowly
    stepWisp();frame();requestAnimationFrame(loop);};
  requestAnimationFrame(loop);
}
})();
