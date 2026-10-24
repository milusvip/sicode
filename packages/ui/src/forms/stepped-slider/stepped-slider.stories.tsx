// @ts-nocheck
import { createSignal } from "solid-js"
import { SteppedSlider } from "./stepped-slider"

const docs = `### Overview
Discrete slider for a small ordered set of options, such as thinking effort.

### API
- \`levels\`: ordered \`{ value, label }\` pairs.
- \`value\` and \`onChange\`: controlled selection.
- \`title\`: panel heading.
- \`label\`: accessible name of the rail.
- \`triggerLabel\`: accessible name of the trigger, which shows only the current level.

### Behavior
- Every position is a level, so dragging snaps to the nearest one while the thumb eases toward it.
- Arrow keys step one level, Home and End jump to the ends.
- Opens in a popover above the trigger; Escape or an outside click closes it.

### Theming/tokens
- Uses \`data-slot="stepped-slider-*"\` attributes and \`--v2-*\` tokens.
`

const EFFORT = [
  { value: "default", label: "default" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "max", label: "max" },
]

const PAIR = [
  { value: "balanced", label: "balanced" },
  { value: "high", label: "high" },
]

export default {
  title: "UI/SteppedSlider",
  id: "ui-stepped-slider",
  component: SteppedSlider,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => {
    const [value, setValue] = createSignal("medium")

    return (
      <SteppedSlider
        levels={EFFORT}
        value={value()}
        onChange={setValue}
        title="Thinking"
        label="Thinking effort"
        triggerLabel={`Thinking effort: ${value()}`}
      />
    )
  },
}

export const TwoLevels = {
  render: () => {
    const [value, setValue] = createSignal("balanced")

    return (
      <SteppedSlider
        levels={PAIR}
        value={value()}
        onChange={setValue}
        title="Thinking"
        label="Thinking effort"
        triggerLabel={`Thinking effort: ${value()}`}
      />
    )
  },
}
