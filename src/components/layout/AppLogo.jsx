import { APP_LOGO, APP_NAME } from "@/lib/branding";

// logo.png is 450×444 with a white (non-transparent) border around the red rounded square
// (square at x 8–441, y 5–438; corners ≈ 12% radius). Rounding the <img> alone leaves ~1px white
// slivers along the edges at header size, so the image is cropped to the red square instead:
// scaled up and shifted inside an overflow-hidden frame. The crop is inset 2 source px further to
// swallow anti-aliased edge pixels, and the frame's radius is a bit larger than the logo's own.
const CROP = { x: 10, y: 7, size: 430, width: 450, height: 444 };
export const LOGO_CROP_STYLE = {
  width: `${((CROP.width / CROP.size) * 100).toFixed(2)}%`,
  height: `${((CROP.height / CROP.size) * 100).toFixed(2)}%`,
  left: `${(-(CROP.x / CROP.size) * 100).toFixed(2)}%`,
  top: `${(-(CROP.y / CROP.size) * 100).toFixed(2)}%`,
};

export default function AppLogo({ className = "w-12 h-12" }) {
  return (
    <span className={`relative inline-block flex-shrink-0 overflow-hidden rounded-[18%] ${className}`} data-testid="app-logo">
      <img src={APP_LOGO} alt={APP_NAME} className="absolute max-w-none" style={LOGO_CROP_STYLE} />
    </span>
  );
}
