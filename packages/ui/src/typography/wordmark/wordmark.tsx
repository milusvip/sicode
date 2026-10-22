import { createUniqueId, type ComponentProps } from "solid-js"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 174 42"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M24 12H0V6H24V12ZM6 18H0V12H6V18ZM24 24H0V18H24V24ZM24 30H18V24H24V30ZM24 36H0V30H24V36Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M45 12H39V6H45V12ZM45 36H39V18H45V36Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M84 12H66V30H84V36H60V6H84V12Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M108 12H96V30H108V12ZM114 36H90V6H114V36Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M138 12H126V30H138V12ZM144 36H120V6H138V0H144V36Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M174 24H156V30H174V36H150V6H174V24ZM156 18H168V12H156V18Z"
            />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="174" height="42">
          <rect width="174" height="42" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="87" y1="22" x2="87" y2="42" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
