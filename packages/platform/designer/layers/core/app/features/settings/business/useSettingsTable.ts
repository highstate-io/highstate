export type TableHeader = {
  title: string
  key: string
  align?: "start" | "center" | "end"
  headerProps?: {
    defaultPrimaryIcon?: string
    defaultPrimaryIconColor?: string
  }
}

export const baseHeaders = {
  name: {
    key: "meta.title",
    title: "Name & Description",
  },

  id: {
    key: "id",
    title: "ID",
  },

  createdAt: {
    key: "createdAt",
    title: "Created",
  },

  actions: {
    key: "actions",
    title: "Actions",
    align: "center",
  },
}
