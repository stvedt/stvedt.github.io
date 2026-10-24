// Volumetric fog: two WebGL2 layers raymarched through 3D noise, one behind the type and one drifting over it.
(() => {
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const vs=`#version 300 es
in vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }`;
// Raymarch a slab of 3D noise between zA and zB, front-to-back, output premultiplied.
const fs=(STEPS)=>`#version 300 es
precision highp float;
uniform vec2 R; uniform float T; uniform vec2 M; uniform vec2 V;
uniform float zA,zB,gain,backlit,clearAmt,jitAmt;
out vec4 o;
float h3(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.x+p.y)*p.z); }
float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float v=0.,a=.5; for(int k=0;k<4;k++){ v+=a*n3(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5; } return v; }
float dens(vec3 p){
  vec3 q=p*vec3(.9,1.25,.9);
  q+=vec3(T*.028,-T*.004,T*.012);
  float w=fbm(q*.45+vec3(0.,0.,T*.006));
  float d=fbm(q+vec3(w*1.6,w*.5,w*.8));
  d=smoothstep(.42,.9,d);
  d*=mix(1.15,.45,smoothstep(-.6,.7,p.y));   // fog pools low
  return d;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*R)/R.y;
  vec2 m=(M-.5)*vec2(R.x/R.y,1.);
  float jit=mix(.5,h3(vec3(gl_FragCoord.xy,fract(T)*61.)),jitAmt);
  vec2 dm=uv-m; float near=exp(-dot(dm,dm)*7.);
  vec3 col=vec3(0.); float acc=0.;
  float dz=(zB-zA)/${STEPS}.;
  for(int i=0;i<${STEPS};i++){
    float z=zA+dz*(float(i)+jit);
    vec3 p=vec3(uv*(.6+z*.55),z*1.3);
    p.xy-=m*.10/z;                         // parallax: near fog shifts more
    p.xy-=V*near*(.9/z);                   // wake from cursor motion
    float d=dens(p)*gain;
    d*=1.-clearAmt*near;                   // breath of clear air around the cursor
    float a=1.-exp(-d*dz*2.4);
    float depth=exp(-(z-.3)*.38);
    float glow=backlit*exp(-dot(uv,uv)*2.2);
    vec3 c=vec3(.80,.81,.82)*(.16+.55*d)*depth+vec3(.95,.93,.88)*glow*d*.55;
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
  const uR=U('R'),uT=U('T'),uM=U('M'),uV=U('V');
  return {
    resize(){ const s=Math.min(devicePixelRatio||1,2)*opt.res; cv.width=Math.max(2,Math.round(innerWidth*s)); cv.height=Math.max(2,Math.round(innerHeight*s)); gl.viewport(0,0,cv.width,cv.height); },
    draw(t,m,v){ gl.uniform2f(uR,cv.width,cv.height);gl.uniform1f(uT,t);gl.uniform2f(uM,m.x,m.y);gl.uniform2f(uV,v.x,v.y);gl.drawArrays(gl.TRIANGLES,0,3); }
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
function frame(){back.draw(T,m,v);front&&front.draw(T,m,v);}
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
    frame();requestAnimationFrame(loop);};
  requestAnimationFrame(loop);
}
})();
