import type { MouseEvent } from 'react'
import logoDark from '../../assets/logo.svg'
import {
  intelligenceNavigationItems,
  isNavigationItemActive,
  navigationFontFamily,
  primaryNavigationItems,
  workspaceNavigation,
  type NavigationGroupDefinition,
  type NavigationItemDefinition,
} from './navigationModel'
import { NavigationGroupChevron, SidebarNavigationIcon } from './SidebarNavigationIcons'
import type { SidebarNavigationProps } from './navigationTypes'
import { useSidebarNavigation } from './useSidebarNavigation'

function setHoverBackground(event: MouseEvent<HTMLButtonElement>, color: string) {
  event.currentTarget.style.backgroundColor = color
}

function NavigationItemButton({
  activePage,
  collapsed,
  item,
  onActivate,
  pathname,
}: {
  activePage: string
  collapsed: boolean
  item: NavigationItemDefinition
  onActivate: (item: NavigationItemDefinition) => void
  pathname: string
}) {
  const active = isNavigationItemActive(item, activePage, pathname)

  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: '12px',
        padding: collapsed ? '10px' : '10px 16px',
        borderRadius: '8px',
        cursor: 'pointer',
        backgroundColor: active ? '#F5F5F5' : 'transparent',
        color: '#454545',
        transition: 'all 0.2s ease',
        border: 'none',
        width: '100%',
        fontFamily: navigationFontFamily,
      }}
      onMouseEnter={(event) => {
        if (!active) setHoverBackground(event, '#F5F5F5')
      }}
      onMouseLeave={(event) => {
        if (!active) setHoverBackground(event, 'transparent')
      }}
      title={collapsed ? item.label : undefined}
      onClick={() => onActivate(item)}
    >
      <div style={{ display: 'flex' }}>
        <span
          style={{
            display: 'flex',
            width: '24px',
            height: '24px',
            color: '#454545',
            flexShrink: 0,
          }}
        >
          <SidebarNavigationIcon icon={item.icon} />
        </span>
        {!collapsed && (
          <span
            style={{
              fontSize: '16px',
              fontWeight: 510,
              letterSpacing: '-0.8px',
              lineHeight: '21px',
              whiteSpace: 'nowrap',
            }}
          >
            {item.label}
          </span>
        )}
      </div>
    </button>
  )
}

function NavigationGroup({
  activePage,
  collapsed,
  expanded,
  group,
  onActivate,
  onNavigate,
  onToggle,
  pathname,
}: {
  activePage: string
  collapsed: boolean
  expanded: boolean
  group: NavigationGroupDefinition
  onActivate: (item: NavigationItemDefinition) => void
  onNavigate: (path: string) => void
  onToggle: () => void
  pathname: string
}) {
  const contentId = `sidebar-${group.id}-navigation`
  const contentVisible = expanded && !collapsed

  return (
    <div>
      {group.presentation === 'disclosure' && (
        <button
          type="button"
          aria-expanded={collapsed ? undefined : expanded}
          aria-controls={contentId}
          aria-label={collapsed ? group.label : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: collapsed ? '10px' : '10px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            backgroundColor: 'transparent',
            color: '#454545',
            transition: 'all 0.2s ease',
            border: 'none',
            width: '100%',
            fontFamily: navigationFontFamily,
          }}
          onMouseEnter={(event) => setHoverBackground(event, '#F5F5F5')}
          onMouseLeave={(event) => setHoverBackground(event, 'transparent')}
          onClick={() => {
            if (collapsed) onNavigate(group.defaultRoute)
            else onToggle()
          }}
          title={collapsed ? group.label : undefined}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: collapsed ? 0 : '8px' }}>
            <span
              style={{
                display: 'flex',
                width: '19px',
                height: '19px',
                color: '#454545',
                flexShrink: 0,
              }}
            >
              <SidebarNavigationIcon icon={group.icon} />
            </span>
            {!collapsed && (
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: 510,
                  letterSpacing: '-0.8px',
                  lineHeight: '21px',
                  whiteSpace: 'nowrap',
                }}
              >
                {group.label}
              </span>
            )}
          </div>
          {!collapsed && <NavigationGroupChevron expanded={expanded} />}
        </button>
      )}

      <div
        id={contentId}
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: contentVisible ? '200px' : '0px',
          opacity: contentVisible ? 1 : 0,
          transition: 'max-height 0.8s ease, opacity 0.3s ease',
        }}
      >
        {group.items.map((item) => {
          const active = isNavigationItemActive(item, activePage, pathname)
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '10px 15px',
                cursor: 'pointer',
                marginLeft: '20px',
                borderRadius: '6px',
                backgroundColor: active ? '#F5F5F5' : 'transparent',
                transition: 'background-color 0.2s ease',
                border: 'none',
                width: 'calc(100% - 20px)',
                fontFamily: navigationFontFamily,
              }}
              onMouseEnter={(event) => {
                if (!active) setHoverBackground(event, '#F5F5F5')
              }}
              onMouseLeave={(event) => {
                if (!active) setHoverBackground(event, 'transparent')
              }}
              onClick={() => onActivate(item)}
            >
              <span style={{ display: 'flex', width: '16px', height: '16px', flexShrink: 0 }}>
                <SidebarNavigationIcon icon={item.icon} />
              </span>
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 510,
                  color: '#454545',
                  letterSpacing: '-0.7px',
                  lineHeight: '16px',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NavigationSectionLabel({ collapsed, label }: { collapsed: boolean; label: string }) {
  if (collapsed) {
    return <div style={{ margin: '12px 8px', borderTop: '1px solid #EDEDED' }} />
  }

  return (
    <div style={{ marginTop: '16px', marginBottom: '8px', padding: '0 16px' }}>
      <span
        style={{
          fontSize: '14px',
          fontWeight: 510,
          color: '#999999',
          letterSpacing: '-0.42px',
        }}
      >
        {label}
      </span>
    </div>
  )
}

export function SidebarNavigation({
  activePage,
  collapsed,
  onLibraryClick,
}: SidebarNavigationProps) {
  const {
    expandedGroups,
    navigate: onNavigate,
    pathname,
    toggleGroup,
  } = useSidebarNavigation(collapsed)

  const activateItem = (item: NavigationItemDefinition) => {
    if (item.target.kind === 'route') onNavigate(item.target.path)
    else onLibraryClick()
  }

  return (
    <aside
      style={{
        width: collapsed ? '72px' : '220px',
        height: '100%',
        backgroundColor: '#FFFFFF',
        borderRight: '1px solid #EDEDED',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 12px',
        boxSizing: 'border-box',
        flexShrink: 0,
        transition: 'width 0.2s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? '0' : '0 16px',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            src={logoDark}
            alt={collapsed ? 'Prism' : ''}
            style={{ width: '28px', height: '28px', flexShrink: 0 }}
          />
          {!collapsed && (
            <span
              style={{
                fontSize: '24px',
                fontWeight: 400,
                color: '#454545',
                letterSpacing: '-0.72px',
                fontFamily: navigationFontFamily,
              }}
            >
              Prism
            </span>
          )}
        </div>
      </div>

      <nav
        aria-label="Primary navigation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          flex: 1,
          fontFamily: navigationFontFamily,
        }}
      >
        {primaryNavigationItems.map((item) => (
          <NavigationItemButton
            key={item.id}
            activePage={activePage}
            collapsed={collapsed}
            item={item}
            onActivate={activateItem}
            pathname={pathname}
          />
        ))}

        <NavigationSectionLabel collapsed={collapsed} label="Workspace" />
        {workspaceNavigation.map((entry) =>
          entry.kind === 'item' ? (
            <NavigationItemButton
              key={entry.item.id}
              activePage={activePage}
              collapsed={collapsed}
              item={entry.item}
              onActivate={activateItem}
              pathname={pathname}
            />
          ) : (
            <NavigationGroup
              key={entry.group.id}
              activePage={activePage}
              collapsed={collapsed}
              expanded={expandedGroups[entry.group.id]}
              group={entry.group}
              onActivate={activateItem}
              onNavigate={onNavigate}
              onToggle={() => toggleGroup(entry.group.id)}
              pathname={pathname}
            />
          ),
        )}

        <NavigationSectionLabel collapsed={collapsed} label="Intelligence" />
        {intelligenceNavigationItems.map((item) => (
          <NavigationItemButton
            key={item.id}
            activePage={activePage}
            collapsed={collapsed}
            item={item}
            onActivate={activateItem}
            pathname={pathname}
          />
        ))}
      </nav>
    </aside>
  )
}
