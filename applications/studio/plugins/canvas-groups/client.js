export default function (ctx, sdk) {
  const s = ctx.canvasSession,
    view = ctx.canvasUI;
  const schema = {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" } },
      title: { type: "string" },
    },
    required: ["ids"],
  };
  s.actions.register(ctx, {
    id: "group",
    label: "将卡片编组",
    schema,
    async run({ ids, title = "分组" }) {
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 99 ||
        new Set(ids).size !== ids.length
      )
        throw Error("请选择 1–99 张不同卡片");
      const nodes = ids.map((id) => s.board().nodes.find((n) => n.id === id));
      if (nodes.some((n) => !n || n.type === "group" || n.groupId))
        throw Error("请选择未编组的普通卡片");
      const bounds = view.bounds(nodes),
        id = crypto.randomUUID();
      await s.edit([
        {
          type: "add",
          node: {
            id,
            type: "group",
            title,
            x: bounds.x - 24,
            y: bounds.y - 24,
            width: bounds.width + 48,
            height: bounds.height + 48,
          },
        },
        ...ids.map((id2) => ({
          type: "update",
          id: id2,
          patch: { groupId: id },
        })),
      ]);
      view.select([id]);
      return { id };
    },
  });
  s.actions.register(ctx, {
    id: "ungroup",
    label: "取消卡片编组",
    schema,
    async run({ ids }) {
      if (!Array.isArray(ids)) throw Error("请选择分组");
      const groups = new Set(
        ids
          .map((id) => {
            const n = s.board().nodes.find((n) => n.id === id);
            return n?.type === "group" ? n.id : n?.groupId;
          })
          .filter(Boolean),
      );
      const members = s.board().nodes.filter((n) => groups.has(n.groupId));
      if (!groups.size) throw Error("所选卡片没有分组");
      const ops = [
        ...members.map((n) => ({
          type: "update",
          id: n.id,
          patch: {},
          unset: ["groupId"],
        })),
        { type: "remove", ids: [...groups] },
      ];
      if (ops.length > 100) throw Error("请分批取消编组，每次最多 100 个操作");
      await s.edit(ops);
      view.select(members.map((n) => n.id));
      return { ids: members.map((n) => n.id) };
    },
  });
  view.register(ctx, {
    id: "group",
    label: "分组",
    icon: "▢",
    height: 240,
    render() {},
  });
  view.menu(ctx, {
    id: "group",
    label: "编组",
    order: 40,
    run: () => s.execute("group", { ids: view.selection() }),
  });
}
