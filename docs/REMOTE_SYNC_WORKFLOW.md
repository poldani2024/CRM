# Flujo recomendado: cambios hechos por Codex -> tu repositorio GitHub

Este repositorio se edita en un entorno aislado (como el de Codex), que **puede no tener remoto configurado**.
Por eso, aunque Codex haga commits, esos cambios no se publican automáticamente en GitHub.

## Objetivo
Tener un flujo repetible para:
1. Recibir cambios de Codex.
2. Aplicarlos en tu repo real (GitHub/local/Codespaces).
3. Subirlos con `git push`.

---

## Opción A (recomendada): usar patch

### 1) En entorno Codex: exportar el último commit
Desde la raíz del repo:

```bash
bash scripts/export_latest_commit.sh
```

Esto genera `out/latest_commit.patch`.

### 2) Llevar el patch a tu entorno con remoto
Copiá `out/latest_commit.patch` a tu repo real (local o Codespaces).

### 3) Aplicar patch en tu repo real

```bash
git apply --index latest_commit.patch
git commit -m "Apply Codex changes"
git push origin <tu-rama>
```

> Si el patch no aplica por diferencias de base, actualizá tu rama (`git pull`) y reintentá.

---

## Opción B: replicar cambios manualmente en GitHub Web
Si no usás entorno local ni Codespaces:
- Abrí cada archivo modificado en GitHub.com.
- Editá/creá archivos.
- Commit desde la web en `main` o en una rama.

Es más lento y propenso a errores, pero funciona.

---

## Checklist de publicación
1. `git status` limpio luego del commit.
2. `git push` exitoso.
3. En GitHub se ve el commit.
4. En GitHub Pages: esperar 1–3 min y refrescar.

---

## Nota importante
`make_pr` (mensaje de PR generado por Codex) **no reemplaza** `git push`.
Solo documenta los cambios; publicar requiere push a tu remoto.
