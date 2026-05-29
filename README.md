# Artifacts (GitHub Pages)

Sitio estático con múltiples herramientas HTML para clientes.

## Estructura sugerida

- `index.html`: portada del proyecto (listado de herramientas)
- `pages/`: herramientas `.htm/.html`

## Publicación con GitHub Pages

1. Conecta este directorio al repo:
   - `git init`
   - `git remote add origin https://github.com/cto-ulpik/artifacts.git`
2. Crea primer commit y súbelo:
   - `git add .`
   - `git commit -m "chore: bootstrap github pages tools site"`
   - `git branch -M main`
   - `git push -u origin main`
3. En GitHub:
   - Settings -> Pages
   - Build and deployment -> Source: `Deploy from a branch`
   - Branch: `main` y carpeta `/ (root)`

URL esperada:

- `https://cto-ulpik.github.io/artifacts/`

## Agregar nuevas herramientas

1. Crea archivo en `pages/`, por ejemplo:
   - `pages/mi_herramienta.html`
2. Agrega un enlace en `index.html`.
3. Commit + push.
