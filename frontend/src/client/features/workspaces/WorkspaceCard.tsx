import { useEffect, useRef, useState } from 'react'
import calendarIcon from '../../assets/calendar-icon.svg'
import pencilEditIcon from '../../assets/pencil-edit-icon.svg'
import profileUsersIcon from '../../assets/profile-users-icon.svg'
import projectOpenIcon from '../../assets/project-open-icon.svg'
import shareIcon from '../../assets/share-icon.svg'
import trashIcon from '../../assets/trash-icon.svg'
import { useMenuFocus } from '../../hooks/useMenuFocus'
import { ProjectIcon } from '../../components/icons'
import { Button, IconButton } from '../../components/ui/Button'
import type { WorkspaceListAction } from './useWorkspaceListSession'
import { workspaceFont, type WorkspaceCardModel } from './workspaceModels'

const dropdownOptions: Array<{
  id: WorkspaceListAction
  label: string
  icon: string
  danger?: boolean
}> = [
  { id: 'open', label: 'Open Project', icon: projectOpenIcon },
  { id: 'rename', label: 'Rename', icon: pencilEditIcon },
  { id: 'share', label: 'Share', icon: shareIcon },
  { id: 'delete', label: 'Delete', icon: trashIcon, danger: true },
]

function formatDate(dateString: string) {
  const date = new Date(dateString)
  const currentYear = new Date().getFullYear()
  const day = date.getDate().toString().padStart(2, '0')
  const month = date.toLocaleString('en-US', { month: 'short' })
  const year = date.getFullYear()
  return year === currentYear ? `${day} ${month}` : `${day} ${month} ${year}`
}

function DocumentsIcon() {
  return (
    <div
      style={{
        display: 'inline-grid',
        gridTemplateColumns: 'max-content',
        gridTemplateRows: 'max-content',
        placeItems: 'start',
        position: 'relative',
      }}
    >
      <div
        style={{
          backgroundColor: '#EDEDED',
          width: '10.3px',
          height: '12.5px',
          borderRadius: '1.5px',
          overflow: 'hidden',
          position: 'relative',
          gridColumn: 1,
          gridRow: 1,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            top: '2.8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.7px',
            width: '8.2px',
          }}
        >
          <div
            style={{
              backgroundColor: '#D9D9D9',
              height: '0.8px',
              borderRadius: '1px',
              width: '100%',
            }}
          />
          <div
            style={{
              backgroundColor: '#D9D9D9',
              height: '0.8px',
              borderRadius: '1px',
              width: '100%',
            }}
          />
          <div
            style={{
              backgroundColor: '#D9D9D9',
              height: '0.8px',
              borderRadius: '1px',
              width: '6px',
            }}
          />
        </div>
      </div>
      <div
        style={{
          gridColumn: 1,
          gridRow: 1,
          marginLeft: '2.5px',
          marginTop: '0.1px',
          width: '14.5px',
          height: '15.6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ transform: 'rotate(24.39deg)' }}>
          <div
            style={{
              backgroundColor: '#F7F7F7',
              width: '10.3px',
              height: '12.5px',
              borderRadius: '1.5px',
              overflow: 'hidden',
              boxShadow: '0px 0px 3.4px rgba(0,0,0,0.25)',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                top: '2.8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.7px',
                width: '8.2px',
              }}
            >
              <div
                style={{
                  backgroundColor: '#D9D9D9',
                  height: '0.8px',
                  borderRadius: '1px',
                  width: '100%',
                }}
              />
              <div
                style={{
                  backgroundColor: '#D9D9D9',
                  height: '0.8px',
                  borderRadius: '1px',
                  width: '100%',
                }}
              />
              <div
                style={{
                  backgroundColor: '#D9D9D9',
                  height: '0.8px',
                  borderRadius: '1px',
                  width: '6px',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EllipsisIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="4" r="1.5" fill="#454545" />
      <circle cx="10" cy="10" r="1.5" fill="#454545" />
      <circle cx="10" cy="16" r="1.5" fill="#454545" />
    </svg>
  )
}

function getRoleColor(role: string) {
  if (role === 'owner' || role === 'admin') return '#659d0b'
  if (role === 'editor') return '#338CE4'
  if (role === 'viewer') return '#999999'
  return '#454545'
}

interface WorkspaceCardProps {
  workspace: WorkspaceCardModel
  onClick: () => void
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenuKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  onAction: (action: WorkspaceListAction) => void
}

export function WorkspaceCard({
  workspace,
  onClick,
  onContextMenu,
  onContextMenuKeyDown,
  onAction,
}: WorkspaceCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownButtonRef = useRef<HTMLButtonElement>(null)
  const dropdownMenuRef = useMenuFocus({
    open: dropdownOpen,
    onClose: () => setDropdownOpen(false),
    onOpen: () => setDropdownOpen(true),
    triggerRef: dropdownButtonRef,
  })

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        dropdownMenuRef.current &&
        !dropdownMenuRef.current.contains(target) &&
        !dropdownButtonRef.current?.contains(target)
      ) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownMenuRef, dropdownOpen])

  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '9px',
        padding: '16px 12px',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
        position: 'relative',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false)
        if (!dropdownOpen) setDropdownOpen(false)
      }}
      onFocusCapture={() => setIsHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsHovered(false)
      }}
    >
      <Button
        aria-label={`Open ${workspace.name}`}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={onContextMenuKeyDown}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          border: 'none',
          borderRadius: '9px',
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
      {dropdownOpen && (
        <div
          id={`workspace-actions-${workspace.id}`}
          ref={dropdownMenuRef}
          role="menu"
          aria-label={`Actions for ${workspace.name}`}
          style={{
            position: 'absolute',
            top: '40px',
            right: '12px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #F7F7F7',
            borderRadius: '8px',
            boxShadow: '0px 0px 11.5px rgba(0, 0, 0, 0.24)',
            minWidth: '170px',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {dropdownOptions.map((option) => (
            <Button
              key={option.id}
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                setDropdownOpen(false)
                onAction(option.id)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 15px',
                height: '40px',
                boxSizing: 'border-box',
                cursor: 'pointer',
                backgroundColor: '#FFFFFF',
                transition: 'background-color 0.15s ease',
                border: 'none',
                width: '100%',
                fontFamily: workspaceFont,
                textAlign: 'left',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = '#F5F5F5'
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = '#FFFFFF'
              }}
            >
              <img src={option.icon} alt="" style={{ width: '16px', height: '16px' }} />
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 510,
                  color: option.danger ? '#E53935' : '#454545',
                  letterSpacing: '-0.7px',
                  lineHeight: '16px',
                  fontFamily: workspaceFont,
                  whiteSpace: 'nowrap',
                }}
              >
                {option.label}
              </span>
            </Button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <IconButton
              ref={dropdownButtonRef}
              label={`More actions for ${workspace.name}`}
              tabIndex={isHovered || dropdownOpen ? 0 : -1}
              aria-haspopup="menu"
              aria-expanded={dropdownOpen}
              aria-controls={dropdownOpen ? `workspace-actions-${workspace.id}` : undefined}
              onClick={(event) => {
                event.stopPropagation()
                setDropdownOpen(!dropdownOpen)
              }}
              style={{
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isHovered || dropdownOpen ? 'pointer' : 'default',
                border: 'none',
                padding: 0,
                background: 'transparent',
                position: 'relative',
                zIndex: 2,
              }}
            >
              {isHovered || dropdownOpen ? <EllipsisIcon /> : <ProjectIcon size={20} alt="" />}
            </IconButton>
            <span
              style={{
                fontSize: '18px',
                fontWeight: 510,
                color: '#454545',
                letterSpacing: '-0.9px',
                overflowX: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100px',
              }}
            >
              {workspace.name}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <img src={calendarIcon} alt="" style={{ width: '12px', height: '12px' }} />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 510,
                color: '#454545',
                letterSpacing: '-0.6px',
                lineHeight: '16px',
                whiteSpace: 'nowrap',
              }}
            >
              {formatDate(workspace.created_at)}
            </span>
          </div>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: '12px',
            fontWeight: 400,
            color: '#999999',
            letterSpacing: '-0.6px',
            lineHeight: '14px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            height: '28px',
          }}
        >
          {workspace.description || 'Workspace file governance'}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <DocumentsIcon />
          <span
            style={{
              fontSize: '12px',
              fontWeight: 510,
              color: '#454545',
              letterSpacing: '-0.6px',
              lineHeight: '16px',
            }}
          >
            Documents : {workspace.filesCount}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <img src={profileUsersIcon} alt="" style={{ width: '15px', height: '15px' }} />
          <span
            style={{
              fontSize: '12px',
              fontWeight: 510,
              color: '#454545',
              letterSpacing: '-0.6px',
              lineHeight: '16px',
            }}
          >
            Members : {workspace.membersCount}
          </span>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {workspace.members.slice(0, 3).map((member, index) => (
              <div
                key={index}
                style={{
                  width: '15px',
                  height: '15px',
                  borderRadius: '50%',
                  backgroundColor: member.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: '-6px',
                }}
              >
                <span
                  style={{
                    fontSize: '5.3px',
                    fontWeight: 510,
                    color: '#FFFFFF',
                    letterSpacing: '-0.27px',
                  }}
                >
                  {member.initials}
                </span>
              </div>
            ))}
          </div>
        </div>
        {workspace.sharedBy && (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 510,
                color: '#454545',
                letterSpacing: '-0.6px',
                lineHeight: '16px',
              }}
            >
              Shared By {workspace.sharedBy}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 510,
              color: '#454545',
              letterSpacing: '-0.6px',
              lineHeight: '16px',
            }}
          >
            Role :
          </span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 510,
              color: getRoleColor(workspace.role),
              letterSpacing: '-0.6px',
              lineHeight: '16px',
            }}
          >
            {workspace.role.charAt(0).toUpperCase() + workspace.role.slice(1)}
          </span>
        </div>
      </div>
    </div>
  )
}
