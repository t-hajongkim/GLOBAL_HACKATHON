import type { AvatarColor } from '../shared/protocol.ts'

const palettes: Record<AvatarColor, {
  shirt: string; shadow: string; hair: string; skin: string; accessory: string
}> = {
  mint: { shirt: '#77b9a2', shadow: '#417765', hair: '#4e3932', skin: '#f1c7a5', accessory: '#9dd1a8' },
  lilac: { shirt: '#b499cf', shadow: '#786091', hair: '#544258', skin: '#ecc1a3', accessory: '#dbbee9' },
  peach: { shirt: '#da9373', shadow: '#aa604b', hair: '#813f31', skin: '#f6d6b6', accessory: '#f5bb85' },
  sky: { shirt: '#7dabc1', shadow: '#4c758a', hair: '#313e49', skin: '#c99572', accessory: '#a8d7df' },
  sunflower: { shirt: '#d6b660', shadow: '#9e8138', hair: '#6d4c31', skin: '#ebbb94', accessory: '#f4d78c' },
  rose: { shirt: '#cc8391', shadow: '#945567', hair: '#a56f43', skin: '#f1c9ac', accessory: '#ebb1bf' },
}

export function PixelAvatar({
  color = 'mint', back = false, className = '', size = 48,
}: { color?: AvatarColor; back?: boolean; className?: string; size?: number }) {
  const palette = palettes[color]
  return (
    <svg className={`pixel-avatar ${className}`} width={size} height={size * 1.25}
      viewBox="0 0 24 30" fill="none" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#272829" opacity=".2" d="M4 28h16v2H4z" />
      <path fill="#303535" d="M6 24h5v5H5v-2h1zm7 0h5v3h1v2h-6z" />
      <path fill={palette.shadow} d="M5 17h14v9H5z" />
      <path fill={palette.shirt} d="M6 16h12v8H6zM3 18h3v6H3zm15 0h3v6h-3z" />
      <path fill={palette.skin} d="M3 23h3v3H3zm15 0h3v3h-3zM9 14h6v3H9z" />
      <path fill={palette.hair} d="M7 3h10v2h3v10h-2v2H6v-2H4V5h3z" />
      {!back && <>
        <path fill={palette.skin} d="M7 8h10v8H7zM5 10h2v4H5zm12 0h2v4h-2z" />
        <path fill={palette.hair} d="M6 5h12v4h-4V7h-3v3H7z" />
        <path fill="#373332" d="M8 11h2v2H8zm6 0h2v2h-2z" />
        <path fill="#d6977e" d="M10 15h4v1h-4z" />
      </>}
      {back && <path fill="#fff" opacity=".08" d="M7 5h9v2H7zM6 7h3v5H6z" />}
      {color === 'mint' && <>
        <path fill={palette.accessory} d="M5 3h13v3H5zM3 6h18v2H3z" />
        <path fill="#65855c" d="M8 1h7v2H8z" />
        <path fill="#d6e7a2" d="M15 3h2v3h-2z" />
      </>}
      {color === 'sunflower' && <>
        <path fill={palette.accessory} d="M6 2h12v5H6zM3 6h18v2H3z" />
        <path fill="#b09146" d="M6 5h12v1H6z" />
      </>}
      {color === 'rose' && <path fill={palette.accessory} d="M17 7h4v2h-2v2h-2zm-14 0h4v4H5V9H3z" />}
      {color === 'lilac' && <path fill={palette.accessory} d="M15 4h3v3h-3zM17 7h3v2h-3z" />}
      {color === 'sky' && !back && <path fill="#b3dde2" d="M7 10h4v3H7zm6 0h4v3h-4zM11 11h2v1h-2z" />}
      <path fill={palette.accessory} d="M7 18h2v4H7z" />
    </svg>
  )
}

export function PixelPlant({ variant = 0 }: { variant?: number }) {
  return (
    <svg className={`pixel-plant plant-${variant}`} viewBox="0 0 40 64"
      shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#201f1c" opacity=".35" d="M6 59h30v5H6z" />
      <path fill="#cc9465" d="M11 43h20v15H11zM14 58h14v3H14z" />
      <path fill="#e0b080" d="M8 40h26v5H8zM13 46h3v10h-3z" />
      <path fill="#956149" d="M27 45h4v13h-4zM9 44h24v2H9z" />
      <path fill="#547655" d="M19 15h4v26h-4zM10 26h11v4H10zm11 6h12v4H21z" />
      <path fill="#7d9e61" d="M17 4h7v18h-7zM14 8h13v9H14zM3 14h10v13H3zM0 17h16v7H0zM27 11h10v13H27zM23 15h17v6H23z" />
      <path fill="#597f51" d="M4 30h10v9H4zM8 27h10v11H8zM28 27h9v10h-9zM23 32h11v6H23z" />
      <path fill="#a1b77a" d="M17 5h3v9h-3zM3 15h7v3H3zM29 12h6v3h-6z" />
    </svg>
  )
}

export function PixelSprout({ variant = 0 }: { variant?: number }) {
  return (
    <svg className="pixel-sprout" viewBox="0 0 100 100" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#dfcfa9" d="M17 88h70v5H17z" />
      <path fill="#a8b78a" d="M14 63h7v7h-7zm67-28h6v6h-6zM8 33h5v5H8z" />
      <path fill="#d5a363" d="M72 10h4v12h-4zM68 14h12v4H68zM20 14h3v9h-3zM17 17h9v3h-9z" />
      <path fill="#b06e4e" d="M32 64h41v5H32zM36 69h34v16H36zM41 85h24v5H41z" />
      <path fill="#cc8b64" d="M36 67h30v14H36zM41 80h23v7H41z" />
      <path fill="#e4ab78" d="M33 63h40v5H33zM40 70h5v11h-5z" />
      <path fill="#517351" d="M51 27h5v36h-5zM41 44h14v5H41z" />
      <path fill="#769a63" d="M30 27h17v5h7v17H39v-5h-9zM57 20h20v6h6v15H68v5H56z" />
      <path fill="#96b17a" d="M30 27h17v5H35v7h-5zM57 20h20v6H62v9h-5z" />
      <path fill="#466845" d="M39 38h8v6h7v5h-8v-5h-7zM57 36h11v-6h7v6h-7v5H57z" />
      {variant > 0 && <path fill="#e7b366" d="M41 11h5V6h8v5h5v8h-5v5h-8v-5h-5z" />}
    </svg>
  )
}

export function PixelLogo({ small = false }: { small?: boolean }) {
  return (
    <img className="team-logo" src="/team-logo.png" alt="모여극장 로고"
      width={small ? 46 : 54} height={small ? 46 : 54} decoding="async" />
  )
}

export function PixelChair() {
  return (
    <svg className="pixel-chair" viewBox="0 0 42 40" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#211b20" opacity=".45" d="M2 34h38v6H2z" />
      <path fill="#39262e" d="M6 27h6v10H6zm24 0h6v10h-6z" />
      <path fill="#442b33" d="M5 7h4V3h24v4h4v24H5z" />
      <path fill="#a46362" d="M9 5h24v3h3v20H7V8h2z" />
      <path fill="#945453" d="M10 9h22v15H10z" />
      <path fill="#b57970" d="M10 8h22v3H10z" />
      <path fill="#703e43" d="M8 22h26v10H8z" />
      <path fill="#9b5e59" d="M10 24h22v5H10z" />
      <path fill="#c69568" d="M2 20h6v11H2zm32 0h6v11h-6z" />
      <path fill="#e0b384" d="M2 19h6v3H2zm32 0h6v3h-6z" />
      <path fill="#704738" d="M2 30h6v4H2zm32 0h6v4h-6z" />
    </svg>
  )
}
