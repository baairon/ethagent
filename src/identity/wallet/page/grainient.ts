interface GrainientOptions {
  timeSpeed?: number;
  colorBalance?: number;
  warpStrength?: number;
  warpFrequency?: number;
  warpSpeed?: number;
  warpAmplitude?: number;
  blendAngle?: number;
  blendSoftness?: number;
  rotationAmount?: number;
  noiseScale?: number;
  grainAmount?: number;
  grainScale?: number;
  grainAnimated?: boolean;
  contrast?: number;
  gamma?: number;
  saturation?: number;
  centerX?: number;
  centerY?: number;
  zoom?: number;
  color1?: string;
  color2?: string;
  color3?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [
    parseInt(m[1]!, 16) / 255,
    parseInt(m[2]!, 16) / 255,
    parseInt(m[3]!, 16) / 255,
  ];
}

const GRAINIENT_VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const GRAINIENT_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);

  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;

  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);

  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));

  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);}
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;

  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);

  o=vec4(col,1.0);
}
void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("Shader compile failed: " + log);
  }
  return sh;
}

export function startGrainient(canvas: HTMLCanvasElement, opts: GrainientOptions = {}): () => void {
  const o: Required<GrainientOptions> = {
    timeSpeed: 0.25,
    colorBalance: 0.0,
    warpStrength: 1.0,
    warpFrequency: 5.0,
    warpSpeed: 2.0,
    warpAmplitude: 10.0,
    blendAngle: 0.0,
    blendSoftness: 0.05,
    rotationAmount: 500.0,
    noiseScale: 2.0,
    grainAmount: 0.1,
    grainScale: 2.0,
    grainAnimated: false,
    contrast: 1.5,
    gamma: 1.0,
    saturation: 1.0,
    centerX: 0.0,
    centerY: 0.0,
    zoom: 0.9,
    color1: "#000422",
    color2: "#d8dcfa",
    color3: "#000422",
    ...opts,
  };

  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) {
    canvas.style.display = "none";
    return () => {};
  }

  const vs = compileShader(gl, gl.VERTEX_SHADER, GRAINIENT_VERTEX);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, GRAINIENT_FRAGMENT);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("Grainient link failed: " + gl.getProgramInfoLog(prog));
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );
  const posLoc = gl.getAttribLocation(prog, "position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.useProgram(prog);

  const uloc = (name: string) => gl.getUniformLocation(prog, name);
  const u = {
    iTime: uloc("iTime"),
    iResolution: uloc("iResolution"),
    uTimeSpeed: uloc("uTimeSpeed"),
    uColorBalance: uloc("uColorBalance"),
    uWarpStrength: uloc("uWarpStrength"),
    uWarpFrequency: uloc("uWarpFrequency"),
    uWarpSpeed: uloc("uWarpSpeed"),
    uWarpAmplitude: uloc("uWarpAmplitude"),
    uBlendAngle: uloc("uBlendAngle"),
    uBlendSoftness: uloc("uBlendSoftness"),
    uRotationAmount: uloc("uRotationAmount"),
    uNoiseScale: uloc("uNoiseScale"),
    uGrainAmount: uloc("uGrainAmount"),
    uGrainScale: uloc("uGrainScale"),
    uGrainAnimated: uloc("uGrainAnimated"),
    uContrast: uloc("uContrast"),
    uGamma: uloc("uGamma"),
    uSaturation: uloc("uSaturation"),
    uCenterOffset: uloc("uCenterOffset"),
    uZoom: uloc("uZoom"),
    uColor1: uloc("uColor1"),
    uColor2: uloc("uColor2"),
    uColor3: uloc("uColor3"),
  };

  gl.uniform1f(u.uTimeSpeed, o.timeSpeed);
  gl.uniform1f(u.uColorBalance, o.colorBalance);
  gl.uniform1f(u.uWarpStrength, o.warpStrength);
  gl.uniform1f(u.uWarpFrequency, o.warpFrequency);
  gl.uniform1f(u.uWarpSpeed, o.warpSpeed);
  gl.uniform1f(u.uWarpAmplitude, o.warpAmplitude);
  gl.uniform1f(u.uBlendAngle, o.blendAngle);
  gl.uniform1f(u.uBlendSoftness, o.blendSoftness);
  gl.uniform1f(u.uRotationAmount, o.rotationAmount);
  gl.uniform1f(u.uNoiseScale, o.noiseScale);
  gl.uniform1f(u.uGrainAmount, o.grainAmount);
  gl.uniform1f(u.uGrainScale, o.grainScale);
  gl.uniform1f(u.uGrainAnimated, o.grainAnimated ? 1.0 : 0.0);
  gl.uniform1f(u.uContrast, o.contrast);
  gl.uniform1f(u.uGamma, o.gamma);
  gl.uniform1f(u.uSaturation, o.saturation);
  gl.uniform2f(u.uCenterOffset, o.centerX, o.centerY);
  gl.uniform1f(u.uZoom, o.zoom);
  const c1 = hexToRgb(o.color1);
  const c2 = hexToRgb(o.color2);
  const c3 = hexToRgb(o.color3);
  gl.uniform3f(u.uColor1, c1[0], c1[1], c1[2]);
  gl.uniform3f(u.uColor2, c2[0], c2[1], c2[2]);
  gl.uniform3f(u.uColor3, c3[0], c3[1], c3[2]);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const setSize = () => {
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(u.iResolution, w, h);
  };

  const ro = new ResizeObserver(setSize);
  ro.observe(canvas);
  setSize();

  const t0 = performance.now();
  let raf = 0;
  const loop = (t: number) => {
    gl.uniform1f(u.iTime, (t - t0) * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}
