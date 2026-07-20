// ====================================
// 4. services/event/access/event-response.service.ts
// ====================================

import type { EventResponse, UserAccess } from './access.types';
import { sortSubEvents } from '../sub-event.service';

export class EventResponseService {
    /**
     * Build clean event response based on user access level
     */
    buildEventResponse(event: any, userAccess: UserAccess): EventResponse {
        // Base event info that's always safe to share
        const baseResponse: EventResponse = {
            _id: event._id,
            title: event.title,
            description: event.description || '',
            start_date: event.start_date,
            visibility: event.visibility,
            cover_image: event.cover_image?.public_id ? {
                public_id: event.cover_image.public_id
            } : null,
            location: event.location?.name ? {
                name: event.location.name
            } : null,
            styling_config: event.styling_config || {},
            // Functions in timeline order — drives the guest gallery's section
            // dividers. Empty array for single-function events, so casual guests
            // never see the concept. (Phase 1)
            sub_events: sortSubEvents(event.sub_events)
        };

        // Add permissions only if user can join
        if (userAccess.canJoin) {
            baseResponse.permissions = {
                can_upload: event.permissions?.can_upload || false,
                can_download: event.permissions?.can_download || false,
                require_approval: event.permissions?.require_approval || false
            };
        }

        return baseResponse;
    }

    /**
     * Build detailed event data for validation responses
     */
    buildDetailedEventData(event: any) {
        return {
            _id: event._id.toString(),
            title: event.title,
            description: event.description,
            cover_image: event.cover_image,
            location: event.location,
            start_date: event.start_date,
            end_date: event.end_date,
            template: event.template,
            permissions: event.permissions,
            share_settings: event.share_settings,
            created_by: event.created_by
        };
    }
}

// Singleton instance
export const eventResponseService = new EventResponseService();