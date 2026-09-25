import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Button } from './components/button'
import * as dropdown from './components/dropdown-menu'
import * as dialog from './components/dialog'
import * as tabs from './components/tabs'
import { Input } from './components/input'
import { Switch } from './components/switch'
import { Badge } from './components/badge'
import * as tooltip from './components/tooltip'
import {
  Image,
  Table,
  Hand,
  MousePointer2,
  FileText,
  FileCode2,
  LayoutDashboard,
  Plus,
  Search,
  X,
  Pin,
  Download,
  Trash2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  Puzzle,
  Settings2,
  Palette,
  Blocks,
  CircleHelp,
  GripHorizontal,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Heading,
  List,
  Quote,
  Code2,
  Link,
  Moon,
  Sun,
  LoaderCircle,
  ArrowUpRight,
  BookOpen,
  SlidersHorizontal
} from 'lucide-react'

const icons = {
  Image,
  Table,
  Hand,
  MousePointer2,
  FileText,
  FileCode2,
  LayoutDashboard,
  Plus,
  Search,
  X,
  Pin,
  Download,
  Trash2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  Puzzle,
  Settings2,
  Palette,
  Blocks,
  CircleHelp,
  GripHorizontal,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Heading,
  List,
  Quote,
  Code2,
  Link,
  Moon,
  Sun,
  LoaderCircle,
  ArrowUpRight,
  BookOpen,
  SlidersHorizontal
}
function Icon({ name, ...props }) {
  const Component = icons[name] || FileText
  return <Component size={16} strokeWidth={1.7} aria-hidden="true" {...props} />
}
function Slot({ node, className = '' }) {
  const ref = React.useRef(null)
  React.useLayoutEffect(() => {
    const parent = ref.current
    parent.append(node)
    return () => node.remove()
  }, [node])
  return <div ref={ref} className={className} />
}
function useObserve(owner, service) {
  const [, update] = React.useReducer((n) => n + 1, 0)
  // Cordis returns contextual service proxies. Their object identity need not be
  // stable between renders; injection changes restart the consuming plugin.
  const source = React.useRef({ owner, service }).current
  React.useLayoutEffect(() => source.service.observe(source.owner, update), [source])
  return service
}
export function createUI() {
  return {
    React,
    h: React.createElement,
    Button,
    Input,
    Switch,
    Badge,
    Icon,
    Slot,
    useObserve,
    ...dropdown,
    ...dialog,
    ...tabs,
    ...tooltip,
    mount(owner, container, content) {
      const root = createRoot(container, {
        onUncaughtError(error) {
          if (!active) return
          const notice = document.createElement('p')
          notice.className = 'editor-missing'
          notice.setAttribute('role', 'alert')
          notice.textContent = '界面加载失败，可在插件管理中停用后重新启用。' + error.message
          container.replaceChildren(notice)
          container.dispatchEvent(new CustomEvent('cordis-ui-error', { bubbles: true }))
        }
      })
      let active = true
      const render = (element) => {
        if (active) root.render(element)
      }
      owner.effect(() => {
        flushSync(() => root.render(content))
        return () => {
          active = false
          root.unmount()
          container.replaceChildren()
        }
      })
      return { render }
    }
  }
}
