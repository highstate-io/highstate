import type { ObjectDirective } from "vue"
import type { AccessController, AccessRequirement } from "../utils/access-control"
import { shallowRef, watchEffect } from "vue"

export default defineNuxtPlugin({
  dependsOn: ["client"],
  setup(nuxt) {
    const access = nuxt.$access as AccessController

    const bindings = new WeakMap<
      HTMLElement,
      {
        update: (value: AccessRequirement | AccessRequirement[] | undefined) => void
        stop: () => void
      }
    >()

    const directive: ObjectDirective<
      HTMLElement,
      AccessRequirement | AccessRequirement[] | undefined
    > = {
      mounted(element, binding) {
        const value = shallowRef(binding.value)
        const tooltip = document.createElement("span")
        tooltip.className = "access-tooltip"
        tooltip.role = "tooltip"
        tooltip.id = `access-${crypto.randomUUID()}`
        let blocked = false

        const show = () => {
          document.body.append(tooltip)
          const bounds = element.getBoundingClientRect()
          const size = tooltip.getBoundingClientRect()
          const fitsRight = window.innerWidth - bounds.right >= size.width + 16
          tooltip.style.left = `${Math.max(8, Math.min(fitsRight ? bounds.right + 8 : bounds.left, window.innerWidth - size.width - 8))}px`
          tooltip.style.top = `${Math.max(8, Math.min(fitsRight ? bounds.top + (bounds.height - size.height) / 2 : bounds.bottom + 8, window.innerHeight - size.height - 8))}px`
        }

        const hide = () => tooltip.remove()

        // Inert controls do not receive pointer events. Observe their containing
        // surface instead, without introducing wrappers that alter Vuetify layout.
        const hover = (event: PointerEvent) => {
          if (!blocked) {
            return
          }

          const bounds = element.getBoundingClientRect()
          if (
            event.clientX >= bounds.left &&
            event.clientX <= bounds.right &&
            event.clientY >= bounds.top &&
            event.clientY <= bounds.bottom
          ) {
            show()
          } else {
            hide()
          }
        }

        const surface = element.parentElement
        surface?.addEventListener("pointermove", hover)
        surface?.addEventListener("pointerleave", hide)

        const prevent = (event: Event) => {
          if (!blocked) {
            return
          }

          event.preventDefault()
          event.stopImmediatePropagation()
        }

        for (const event of [
          "click",
          "dblclick",
          "keydown",
          "submit",
          "dragstart",
          "drop",
          "pointerdown",
        ]) {
          element.addEventListener(event, prevent, true)
        }

        const stop = watchEffect(() => {
          const status = value.value ? access.status(value.value) : { allowed: true, reason: "" }
          blocked = !status.allowed
          element.classList.toggle("access-disabled", blocked)
          element.inert = blocked

          if (blocked) {
            element.setAttribute("aria-disabled", "true")
            element.setAttribute("aria-description", status.reason)
            element.setAttribute("aria-describedby", tooltip.id)
            tooltip.textContent = status.reason

            if (element.getClientRects().length && access.rejection.value) {
              access.explain(status.reason)
            }
          } else {
            element.removeAttribute("aria-disabled")
            element.removeAttribute("aria-description")
            element.removeAttribute("aria-describedby")
            hide()
          }
        })

        bindings.set(element, {
          update: next => {
            value.value = next
          },
          stop: () => {
            stop()
            surface?.removeEventListener("pointermove", hover)
            surface?.removeEventListener("pointerleave", hide)
            hide()

            for (const event of [
              "click",
              "dblclick",
              "keydown",
              "submit",
              "dragstart",
              "drop",
              "pointerdown",
            ]) {
              element.removeEventListener(event, prevent, true)
            }
          },
        })
      },
      updated(element, binding) {
        bindings.get(element)?.update(binding.value)
      },
      unmounted(element) {
        bindings.get(element)?.stop()
        bindings.delete(element)
      },
    }

    nuxt.vueApp.directive("access", directive)
  },
})
