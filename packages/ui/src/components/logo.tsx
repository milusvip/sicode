import { type ComponentProps } from "solid-js"
import markUrl from "../assets/brand/logo-mark.png"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="SiCode"
    >
      <image data-slot="logo-mark-image" href={markUrl} width="256" height="256" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <image data-slot="logo-splash-image" href={markUrl} width="80" height="80" />
    </svg>
  )
}

// Horizontal lockup drawn entirely as paths so every glyph follows the theme's icon tokens and the
// new-session shimmer can blend over it without a baked-in color.
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 174 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M18 30H0V24H18V30Z" fill="var(--icon-weak-base)" />
        <path d="M24 12H0V6H24V12ZM6 18H0V12H6V18ZM24 24H0V18H24V24ZM24 30H18V24H24V30ZM24 36H0V30H24V36Z" fill="var(--icon-base)" />
        <path d="M45 12H39V6H45V12ZM45 36H39V18H45V36Z" fill="var(--icon-base)" />
        <path d="M84 30H66V18H84V30Z" fill="var(--icon-weak-base)" />
        <path d="M84 12H66V30H84V36H60V6H84V12Z" fill="var(--icon-base)" />
        <path d="M108 30H96V18H108V30Z" fill="var(--icon-weak-base)" />
        <path d="M108 12H96V30H108V12ZM114 36H90V6H114V36Z" fill="var(--icon-base)" />
        <path d="M138 30H126V18H138V30Z" fill="var(--icon-weak-base)" />
        <path d="M138 12H126V30H138V12ZM144 36H120V6H138V0H144V36Z" fill="var(--icon-base)" />
        <path d="M174 24V30H156V24H174Z" fill="var(--icon-weak-base)" />
        <path d="M174 24H156V30H174V36H150V6H174V24ZM156 18H168V12H156V18Z" fill="var(--icon-base)" />
      </g>
    </svg>
  )
}
