/** Chroma-key composition for authored RGB sprite atlases, performed once at preview load. */
export function composeSpriteAtlas(image: HTMLImageElement): HTMLCanvasElement {
  const surface = document.createElement('canvas');
  surface.width = image.naturalWidth; surface.height = image.naturalHeight;
  const gl = surface.getContext('webgl', {alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true});
  if (!gl) throw new Error('無法建立序列素材的透明合成畫面');
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null, texture: WebGLTexture | null = null, buffer: WebGLBuffer | null = null;
  try {
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error('Cannot create sprite shader');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Sprite shader failed');
      return shader;
    };
    program = gl.createProgram();
    if (!program) throw new Error('Cannot create sprite program');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5);gl_Position=vec4(p,0.0,1.0);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `precision mediump float;
      uniform sampler2D atlas; varying vec2 uv;
      void main(){vec4 c=texture2D(atlas,uv);float key=smoothstep(0.14,0.68,min(c.r,c.b)-c.g);
      float a=c.a*(1.0-key);vec3 rgb=clamp((c.rgb-vec3(1.0,0.0,1.0)*key)/max(1.0-key,0.001),0.0,1.0);
      gl_FragColor=vec4(rgb,a);}`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Cannot link sprite program');
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(gl.getUniformLocation(program, 'atlas'), 0); gl.viewport(0, 0, surface.width, surface.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const result = document.createElement('canvas'); result.width = surface.width; result.height = surface.height;
    const ctx = result.getContext('2d'); if (!ctx) throw new Error('Cannot cache sprite composition');
    ctx.drawImage(surface, 0, 0);
    return result;
  } finally {
    gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
