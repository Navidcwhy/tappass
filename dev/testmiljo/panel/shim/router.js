// Ersätter TanStack Router i testmiljön: Route.component blir sidans komponent.
export const createFileRoute = () => (opts) => ({ ...opts, options: opts });
