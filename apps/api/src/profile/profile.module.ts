import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service.js';
import { ProfileController } from './profile.controller.js';

@Module({ controllers: [ProfileController], providers: [ProfileService] })
export class ProfileModule {}
