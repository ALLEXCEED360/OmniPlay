import { Module } from '@nestjs/common';
import { CollectionsService } from './collections.service.js';
import { CollectionsController } from './collections.controller.js';

@Module({ controllers: [CollectionsController], providers: [CollectionsService] })
export class CollectionsModule {}
