import { ProjectIcon } from '../../components/icons'
import { AccessibleDialog } from '../../components/ui/AccessibleDialog'
import { Button } from '../../components/ui/Button'
import {
  dashboardFontFamily,
  reviewAcceptLabel,
  reviewDeclineLabel,
  reviewModalTitle,
} from './dashboardModel'
import type { DashboardSession } from './useDashboard'

export function DashboardReviewDialog({ session }: { session: DashboardSession }) {
  const { selectedReviewItem, reviewModalOpen, isProcessingAction, actionError, actions } = session
  if (!selectedReviewItem) return null

  return (
    <AccessibleDialog
      open={reviewModalOpen}
      onClose={actions.closeReviewModal}
      labelledBy="review-attention-title"
      contentStyle={{
        backgroundColor: '#FFFFFF',
        borderRadius: '12px',
        padding: '24px',
        width: '420px',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
      }}
    >
      <h3
        id="review-attention-title"
        style={{
          margin: '0 0 8px',
          fontSize: '18px',
          fontWeight: 510,
          color: '#272727',
          fontFamily: dashboardFontFamily,
          alignItems: 'center',
          display: 'flex',
          gap: '8px',
        }}
      >
        {selectedReviewItem.sourceType === 'workspace_invitation' ? <ProjectIcon /> : null}
        {reviewModalTitle(selectedReviewItem.sourceType)}
      </h3>
      <p
        style={{
          margin: '0 0 16px',
          fontSize: '16px',
          fontWeight: 510,
          color: '#454545',
          lineHeight: '1.4',
          fontFamily: dashboardFontFamily,
        }}
      >
        {selectedReviewItem.title}
      </p>
      <p
        style={{
          margin: '0 0 24px',
          fontSize: '14px',
          color: '#666666',
          lineHeight: '1.5',
          fontFamily: dashboardFontFamily,
        }}
      >
        {selectedReviewItem.description}
      </p>
      {actionError && (
        <p
          role="alert"
          style={{
            margin: '0 0 16px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: '#FEF2F2',
            color: '#B42318',
            fontSize: '13px',
            fontFamily: dashboardFontFamily,
          }}
        >
          {actionError}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <Button
          onClick={actions.closeReviewModal}
          disabled={isProcessingAction}
          style={{
            padding: '10px 20px',
            backgroundColor: '#F7F7F7',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 510,
            color: 'gray',
            cursor: isProcessingAction ? 'not-allowed' : 'pointer',
            fontFamily: dashboardFontFamily,
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => void actions.declineReviewItem()}
          disabled={isProcessingAction}
          style={{
            padding: '10px 20px',
            backgroundColor: isProcessingAction ? '#CCCCCC' : '#F7F7F7',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 510,
            color: isProcessingAction ? '#999999' : '#E53935',
            cursor: isProcessingAction ? 'not-allowed' : 'pointer',
            fontFamily: dashboardFontFamily,
          }}
        >
          {reviewDeclineLabel(selectedReviewItem.sourceType)}
        </Button>
        <Button
          onClick={() => void actions.acceptReviewItem()}
          disabled={isProcessingAction}
          style={{
            padding: '10px 20px',
            backgroundColor: isProcessingAction ? '#CCCCCC' : '#272727',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 510,
            color: '#FFFFFF',
            cursor: isProcessingAction ? 'not-allowed' : 'pointer',
            fontFamily: dashboardFontFamily,
          }}
        >
          {isProcessingAction ? 'Processing...' : reviewAcceptLabel(selectedReviewItem.sourceType)}
        </Button>
      </div>
    </AccessibleDialog>
  )
}
