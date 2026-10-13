export function readImageMeta(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(Error("图片加载失败"));
    image.src = src;
  });
}
