// ====================================
// 3. services/album/album-permissions.service.ts
// ====================================

import { logger } from "@utils/logger";
import type { AlbumPermissions } from './album.types';

export class AlbumPermissionsService {
    /**
     * Check user permissions for album operations
     */
    async checkAlbumPermissions(
        album: any,
        userId: string,
        operation: 'view' | 'edit' | 'delete' | 'manage'
    ): Promise<AlbumPermissions> {
        try {
            const event = album.event_id;
            
            if (!event) {
                return this.getNoPermissions();
            }

            // Check if user is event owner
            const isEventOwner = event.created_by && event.created_by.toString() === userId;
            
            // Check if user is approved co-host
            const approvedCoHost = event.co_hosts?.find((coHost: any) => 
                coHost.user_id.toString() === userId && 
                coHost.status === 'approved'
            );

            const permissions: AlbumPermissions = {
                canView: true, // Basic viewing allowed for event participants
                canEdit: false,
                canDelete: false,
                canManageContent: false
            };

            // Event owner has all permissions
            if (isEventOwner) {
                return {
                    canView: true,
                    canEdit: true,
                    canDelete: !album.is_default, // Can't delete default album
                    canManageContent: true
                };
            }

            // Co-host permissions based on their role
            if (approvedCoHost) {
                permissions.canEdit = approvedCoHost.permissions?.manage_content || false;
                permissions.canDelete = (approvedCoHost.permissions?.manage_content || false) && !album.is_default;
                permissions.canManageContent = approvedCoHost.permissions?.manage_content || false;
            }

            return permissions;
        } catch (error) {
            logger.error('Error checking album permissions:', error);
            return this.getNoPermissions();
        }
    }

    /**
     * Check if user can perform specific operation
     */
    async canUserPerformOperation(
        album: any,
        userId: string,
        operation: 'view' | 'edit' | 'delete' | 'manage'
    ): Promise<boolean> {
        const permissions = await this.checkAlbumPermissions(album, userId, operation);
        
        switch (operation) {
            case 'view':
                return permissions.canView;
            case 'edit':
                return permissions.canEdit;
            case 'delete':
                return permissions.canDelete;
            case 'manage':
                return permissions.canManageContent;
            default:
                return false;
        }
    }

    /**
     * Get default no-permissions object
     */
    private getNoPermissions(): AlbumPermissions {
        return {
            canView: false,
            canEdit: false,
            canDelete: false,
            canManageContent: false
        };
    }
}

// Singleton instance
export const albumPermissionsService = new AlbumPermissionsService();