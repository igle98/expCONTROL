# Iconos pendientes

Para que la PWA funcione correctamente necesitas dos archivos PNG:

- `icons/icon-192.png` (192×192 px)
- `icons/icon-512.png` (512×512 px)

## Opción rápida: convertir el SVG incluido

Tienes `icons/icon.svg`. Puedes convertirlo con cualquiera de estos métodos:

### Con Inkscape (gratis)
```
inkscape icon.svg -w 192 -h 192 -o icon-192.png
inkscape icon.svg -w 512 -h 512 -o icon-512.png
```

### Con ImageMagick
```
magick icon.svg -resize 192x192 icon-192.png
magick icon.svg -resize 512x512 icon-512.png
```

### Online
Sube `icon.svg` a https://convertio.co/svg-png/ y exporta en los dos tamaños.

## Opción alternativa: iconos genéricos temporales

Si solo quieres probar la app, puedes usar cualquier PNG de 192×192 y 512×512
renombrado como `icon-192.png` e `icon-512.png`. La PWA seguirá funcionando;
solo no tendrá tu icono personalizado.
