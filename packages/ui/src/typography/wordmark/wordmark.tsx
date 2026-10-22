import { createUniqueId, type ComponentProps } from "solid-js"
import markUrl from "../../assets/brand/logo-mark.png"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 156 42"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible": props.outline,
      }}
      role="img"
      aria-label="SiCode"
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <image data-slot="wordmark-mark" href={markUrl} x="0" y="0" width="42" height="42" />
            <text
              data-slot="wordmark-text"
              x="52"
              y="21"
              dominant-baseline="middle"
              font-family="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
              font-size="30"
              font-weight="600"
              letter-spacing="-0.6"
            >
              SiCode
            </text>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="156" height="42">
          <rect width="156" height="42" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="78" y1="22" x2="78" y2="42" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
