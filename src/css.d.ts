// CSS files are bundled as text (esbuild `text` loader) and applied as constructed stylesheets.
declare module '*.css' {
  const css: string;
  export default css;
}
