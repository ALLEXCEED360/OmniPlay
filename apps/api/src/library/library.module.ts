import { Module } from '@nestjs/common';
import { LibraryService } from './library.service.js';
import { LibraryController } from './library.controller.js';

@Module({ controllers: [LibraryController], providers: [LibraryService], exports: [LibraryService] })
export class LibraryModule {}
