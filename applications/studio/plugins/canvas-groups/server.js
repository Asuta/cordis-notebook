export default function (ctx) {
  ctx.canvasDocuments.types.register(ctx, {
    id: "group",
    label: "分组",
    fields: [],
    defaults: () => ({}),
    validate() {},
  });
}
