export default function(ctx, sdk) { document.documentElement.classList.add('theme-moss'); sdk.effect(() => () => document.documentElement.classList.remove('theme-moss')) }
