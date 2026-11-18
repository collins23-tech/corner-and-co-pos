import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await mkdir("dist/assets", { recursive: true });

for (const file of ["index.html", "styles.css", "app.js", "manifest.webmanifest", "privacy.html"]) {
  await copyFile(file, `dist/${file}`);
}

for (const file of ["icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
  await copyFile(`assets/${file}`, `dist/assets/${file}`);
}
