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

// Horizontal lockup: app mark on the left, wordmark on the right. The wordmark is live text so it
// follows the theme's icon tokens (and the new-session shimmer) instead of a baked-in color.
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 156 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      role="img"
      aria-label="SiCode"
    >
      <image data-slot="logo-mark-image" href={markUrl} x="0" y="0" width="42" height="42" />
      <text
        data-slot="logo-wordmark"
        x="52"
        y="21"
        dominant-baseline="middle"
        fill="var(--icon-strong-base)"
        font-family="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        font-size="30"
        font-weight="600"
        letter-spacing="-0.6"
      >
        SiCode
      </text>
    </svg>
  )
}
