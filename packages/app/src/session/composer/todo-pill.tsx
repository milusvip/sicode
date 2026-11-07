import { Popover } from "@kobalte/core/popover"
import { Badge } from "@opencode/ui/badge"
import { createEffect, createMemo, For, Match, on, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { currentTodo, type Todo, type TodoStatus } from "./todos"
import "./todo-pill.css"

/**
 * SiCode: hand-ported from upstream c4c6065ee7 / 6007274795.
 * Lives in the shared composer lane beside running-shell capsules (no own full-width row).
 */
export function SessionTodoPill(props: { todos: readonly Todo[]; defaultOpen?: boolean }) {
  const language = useLanguage()
  const [state, setState] = createStore({ open: props.defaultOpen ?? false })

  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const current = createMemo(() => currentTodo(props.todos))
  const more = createMemo(() => Math.max(0, props.todos.filter((todo) => todo.status === "in_progress").length - 1))
  const label = () => language.plural("session.todo.label", props.todos.length, { done: String(done()) })

  return (
    <Popover open={state.open} onOpenChange={(open) => setState("open", open)} placement="top-end" gutter={8}>
      <Popover.Trigger
        as="button"
        type="button"
        data-component="session-todo-pill"
        data-slot="session-todo-pill"
        data-composer-pill
        aria-label={label()}
      >
        <Show when={current()}>
          {(todo) => (
            <>
              <TodoGlyph status={todo().status} />
              <span dir="auto" class="min-w-0 max-w-[200px] truncate">
                {todo().content}
              </span>
            </>
          )}
        </Show>
        <Show when={more() > 0}>
          <Badge data-slot="session-todo-more" dir="ltr" class="shrink-0">
            {language.t("session.todo.moreInProgress", { count: String(more()) })}
          </Badge>
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content data-slot="session-todo-panel" data-composer-pill-panel aria-label={label()}>
          <TodoList todos={props.todos} />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

function TodoList(props: { todos: readonly Todo[] }) {
  let list: HTMLDivElement | undefined

  createEffect(
    on(
      () => props.todos.findIndex((todo) => todo.status === "in_progress"),
      (index) => {
        if (index < 0 || !list) return
        list.children[index]?.scrollIntoView({ block: "nearest" })
      },
    ),
  )

  return (
    <div
      ref={list}
      data-slot="session-todo-list"
      data-scrollable
      class="flex max-h-[360px] flex-col overflow-y-auto p-1"
    >
      <For each={props.todos}>
        {(todo) => (
          <div
            data-slot="session-todo-row"
            data-status={todo.status}
            class="flex shrink-0 items-start gap-2 rounded-[4px] px-1.5 py-1"
          >
            <span class="flex h-5 shrink-0 items-center">
              <TodoGlyph status={todo.status} />
            </span>
            <span
              dir="auto"
              data-slot="session-todo-text"
              class="min-w-0 flex-1 text-[13px] leading-[var(--line-height-base)] tracking-[-0.04px]"
            >
              {todo.content}
            </span>
          </div>
        )}
      </For>
    </div>
  )
}

function TodoGlyph(props: { status: TodoStatus }) {
  return (
    <svg
      data-slot="session-todo-glyph"
      data-status={props.status}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      class="shrink-0"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" data-slot="session-todo-glyph-track" />
      <Switch>
        <Match when={props.status === "in_progress"}>
          <path d="M8 1.5A6.5 6.5 0 0 1 14.5 8" stroke="currentColor" stroke-linecap="round" />
        </Match>
        <Match when={props.status === "completed"}>
          <path d="M5 8 7.5 11 11 5.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
        </Match>
        <Match when={props.status === "cancelled"}>
          <path d="M3.5 12.5 12.5 3.5" stroke="currentColor" />
        </Match>
      </Switch>
    </svg>
  )
}
