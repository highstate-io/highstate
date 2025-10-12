import type { Operation, TRPCLink } from "@trpc/client"
import type { AnyRouter } from "@trpc/server"
import { observable, type Unsubscribable } from "@trpc/server/observable"

type RouterError<TRouter extends AnyRouter> = TRouter["_def"]["_config"]["$types"]["errorShape"]

type RetryHandler<TRouter extends AnyRouter> = (
  op: Operation,
  error: RouterError<TRouter>,
) => Operation | undefined

export function alterAndRetryLink<TRouter extends AnyRouter>(
  handler: RetryHandler<TRouter>,
): TRPCLink<TRouter> {
  return () => {
    return ({ next, op }) => {
      return observable(observer => {
        const unsubscribes: Unsubscribable[] = []

        const handleSubscription = (operation: Operation) => {
          return next(operation).subscribe({
            next: value => observer.next(value),
            complete: () => observer.complete(),

            error(err) {
              const newOp = handler(operation, err)

              if (newOp) {
                const retryUnsubscribe = handleSubscription(newOp)
                unsubscribes.push(retryUnsubscribe)
              } else {
                observer.error(err)
              }
            },
          })
        }

        const unsubscribe = handleSubscription(op)
        unsubscribes.push(unsubscribe)

        return () => unsubscribes.forEach(unsub => unsub.unsubscribe())
      })
    }
  }
}
